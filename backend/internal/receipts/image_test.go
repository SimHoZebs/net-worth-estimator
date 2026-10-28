package receipts

import (
	"bytes"
	"context"
	"encoding/binary"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestImageNormalizationAndResourceLimits(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewNRGBA(image.Rect(0, 0, 60, 80))); err != nil {
		t.Fatal(err)
	}
	good, err := NormalizeImage(bytes.NewReader(source.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	withPayload := append(append([]byte{}, source.Bytes()...), []byte("private trailing data")...)
	again, err := NormalizeImage(bytes.NewReader(withPayload))
	if err != nil || !bytes.Equal(good.Bytes, again.Bytes) || bytes.Contains(again.Bytes, []byte("private trailing data")) {
		t.Fatal("metadata/trailing data retained")
	}
	for name, input := range map[string][]byte{"spoofed": []byte("<svg>unsafe</svg>"), "too-large": bytes.Repeat([]byte("x"), MaxUploadBytes+1), "truncated": source.Bytes()[:20]} {
		t.Run(name, func(t *testing.T) {
			if _, err := NormalizeImage(bytes.NewReader(input)); err == nil {
				t.Fatal("accepted invalid image")
			}
		})
	}
	var wide bytes.Buffer
	if err := png.Encode(&wide, image.NewNRGBA(image.Rect(0, 0, 10001, 1))); err != nil {
		t.Fatal(err)
	}
	if _, err := NormalizeImage(&wide); err == nil {
		t.Fatal("accepted image over dimension limit")
	}
	if _, err := NewSource(types.ReceiptProvenance{}, nil); err == nil {
		t.Fatal("accepted missing adapter")
	}
	if problem := extractionProblem(context.Canceled); problem.Code != "canceled" {
		t.Fatal(problem)
	}
}

func TestJPEGOrientationAndEXIFRemoval(t *testing.T) {
	var original bytes.Buffer
	if err := jpeg.Encode(&original, image.NewRGBA(image.Rect(0, 0, 60, 80)), nil); err != nil {
		t.Fatal(err)
	}
	tiff := make([]byte, 26)
	copy(tiff, "II")
	binary.LittleEndian.PutUint16(tiff[2:], 42)
	binary.LittleEndian.PutUint32(tiff[4:], 8)
	binary.LittleEndian.PutUint16(tiff[8:], 1)
	binary.LittleEndian.PutUint16(tiff[10:], 0x112)
	binary.LittleEndian.PutUint16(tiff[12:], 3)
	binary.LittleEndian.PutUint32(tiff[14:], 1)
	binary.LittleEndian.PutUint16(tiff[18:], 6)
	segment := append([]byte("Exif\x00\x00"), tiff...)
	data := append([]byte{}, original.Bytes()[:2]...)
	data = append(data, 0xff, 0xe1, byte((len(segment)+2)>>8), byte(len(segment)+2))
	data = append(data, segment...)
	data = append(data, original.Bytes()[2:]...)
	normalized, err := NormalizeImage(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(normalized.Bytes))
	if err != nil || config.Width != 80 || config.Height != 60 || bytes.Contains(normalized.Bytes, []byte("Exif")) {
		t.Fatalf("orientation/EXIF: %+v %v", config, err)
	}
}

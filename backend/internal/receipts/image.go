package receipts

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"image"
	"image/jpeg"
	"image/png"
	"io"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const MaxUploadBytes = 10 << 20
const MaxImageBytes = 3 << 20
const MaxPixels = 20_000_000

// NormalizeImage checks decoded resource use before allocation, applies JPEG
// orientation, and re-encodes pixels without metadata or appended payloads.
func NormalizeImage(reader io.Reader) (types.ReceiptImage, error) {
	data, err := io.ReadAll(io.LimitReader(reader, MaxUploadBytes+1))
	if err != nil {
		return types.ReceiptImage{}, Failure("invalid-input", "The receipt image could not be read.", false)
	}
	if len(data) > MaxUploadBytes {
		return types.ReceiptImage{}, Failure("too-large", "Choose a receipt image smaller than 10 MiB.", false)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return types.ReceiptImage{}, Failure("unsupported-input", "Choose a valid JPEG or PNG receipt image.", false)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 10000 || config.Height > 10000 || int64(config.Width)*int64(config.Height) > MaxPixels {
		return types.ReceiptImage{}, Failure("too-large", "Choose an image no larger than 20 megapixels and 10,000 pixels per side.", false)
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return types.ReceiptImage{}, Failure("invalid-input", "The receipt image is damaged. Choose another image.", false)
	}
	if format == "jpeg" {
		decoded = orientImage(decoded, jpegOrientation(data))
	}
	var output bytes.Buffer
	mediaType := "image/png"
	if format == "jpeg" {
		mediaType = "image/jpeg"
		err = jpeg.Encode(&output, decoded, &jpeg.Options{Quality: 90})
	} else {
		err = png.Encode(&output, decoded)
	}
	if err != nil || output.Len() > MaxImageBytes {
		return types.ReceiptImage{}, Failure("too-large", "The normalized image exceeds 3 MiB. Resize it and try again.", false)
	}
	digest := sha256.Sum256(output.Bytes())
	return types.ReceiptImage{Bytes: output.Bytes(), MediaType: mediaType, Digest: hex.EncodeToString(digest[:])}, nil
}

func jpegOrientation(data []byte) uint16 {
	// Only the bounded TIFF orientation entry is read. All other EXIF is dropped.
	for i := 2; i+4 <= len(data) && data[i] == 0xff; {
		marker := data[i+1]
		if marker == 0xda || marker == 0xd9 {
			break
		}
		size := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if size < 2 || size > len(data)-i-2 {
			break
		}
		segment := data[i+4 : i+2+size]
		if marker == 0xe1 && len(segment) >= 14 && bytes.Equal(segment[:6], []byte("Exif\x00\x00")) {
			tiff := segment[6:]
			var order binary.ByteOrder = binary.BigEndian
			if string(tiff[:2]) == "II" {
				order = binary.LittleEndian
			} else if string(tiff[:2]) != "MM" {
				return 1
			}
			if order.Uint16(tiff[2:4]) != 42 {
				return 1
			}
			offset := uint64(order.Uint32(tiff[4:8]))
			if offset+2 > uint64(len(tiff)) {
				return 1
			}
			count := int(order.Uint16(tiff[offset : offset+2]))
			for entry := offset + 2; count > 0 && entry+12 <= uint64(len(tiff)); entry, count = entry+12, count-1 {
				if order.Uint16(tiff[entry:entry+2]) == 0x112 && order.Uint16(tiff[entry+2:entry+4]) == 3 && order.Uint32(tiff[entry+4:entry+8]) == 1 {
					return order.Uint16(tiff[entry+8 : entry+10])
				}
			}
		}
		i += size + 2
	}
	return 1
}

func orientImage(src image.Image, orientation uint16) image.Image {
	if orientation < 2 || orientation > 8 {
		return src
	}
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	dw, dh := w, h
	if orientation >= 5 {
		dw, dh = h, w
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx, dy := x, y
			switch orientation {
			case 2:
				dx = w - 1 - x
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dy = h - 1 - y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			dst.Set(dx, dy, src.At(x+src.Bounds().Min.X, y+src.Bounds().Min.Y))
		}
	}
	return dst
}

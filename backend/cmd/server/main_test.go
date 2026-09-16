package main

import (
	"reflect"
	"testing"
	"time"
)

func TestParseAllowedOriginsNormalizesAndDeduplicates(t *testing.T) {
	got, err := parseAllowedOrigins(" https://APP.example.com:0443/, http://localhost:080, https://app.example.com ")
	if err != nil {
		t.Fatalf("parse allowed origins: %v", err)
	}
	want := []string{"https://app.example.com", "http://localhost"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("origins = %v, want %v", got, want)
	}
}

func TestParseReadOnlyAcceptsTruthyValues(t *testing.T) {
	for _, value := range []string{"1", "true", "TRUE", " yes "} {
		if !parseReadOnly(value) {
			t.Fatalf("parseReadOnly(%q) = false, want true", value)
		}
	}
}

func TestParseReadOnlyDefaultsToWritable(t *testing.T) {
	for _, value := range []string{"", "0", "false", "no", "banana"} {
		if parseReadOnly(value) {
			t.Fatalf("parseReadOnly(%q) = true, want false", value)
		}
	}
}

func TestNextSyncDelayTargetsMorning(t *testing.T) {
	morning := time.Date(2026, 8, 5, 1, 0, 0, 0, time.UTC)
	delay := nextSyncDelay(morning, 15)
	if delay != 2*time.Hour+15*time.Minute {
		t.Fatalf("delay = %v, want 2h15m", delay)
	}
	afternoon := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	overnight := nextSyncDelay(afternoon, 0)
	if overnight != 15*time.Hour {
		t.Fatalf("delay = %v, want 15h", overnight)
	}
}

func TestParseAllowedOriginsRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{
		"*",
		"null",
		"https://",
		"http://:8787",
		"https://app.example.com:65536",
		"ftp://app.example.com",
		"https://user@app.example.com",
		"https://app.example.com/path",
		"https://app.example.com?query",
		"https://app.example.com#fragment",
		"https://app.example.com,,https://other.example.com",
	} {
		t.Run(value, func(t *testing.T) {
			if _, err := parseAllowedOrigins(value); err == nil {
				t.Fatalf("parseAllowedOrigins(%q) returned no error", value)
			}
		})
	}
}

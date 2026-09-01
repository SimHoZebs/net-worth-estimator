package main

import (
	"reflect"
	"testing"
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

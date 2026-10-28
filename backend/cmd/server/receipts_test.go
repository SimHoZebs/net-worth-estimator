package main

import "testing"

func TestReceiptSourceConfiguration(t *testing.T) {
	for _, value := range []string{"", "disabled"} {
		source, err := configureReceiptSource(value)
		if err != nil || source != nil {
			t.Fatalf("%q=%v %v", value, source, err)
		}
	}
	if source, err := configureReceiptSource("mock"); err != nil || source == nil {
		t.Fatalf("mock=%v %v", source, err)
	}
	if _, err := configureReceiptSource("unknown"); err == nil {
		t.Fatal("unknown source silently enabled")
	}
}

package businesslogos

import (
	"strings"
	"testing"
)

func TestRecognizePrecedenceAndBoundaries(t *testing.T) {
	cases := []struct {
		name                     string
		institution, synced, own string
		want                     string
	}{
		{"bridge institution wins", "JPMorgan Chase Bank", "Venmo", "PayPal", "chase"},
		{"bridge synced name used when institution unknown", "Local Bank", "Klarna", "Chase", "klarna"},
		{"manual name only after bridge sources", "", "", "AMEX Everyday", "american-express"},
		{"manual brand-led descriptor", "", "", "Chase Sapphire", "chase"},
		{"manual exact single token", "", "", "chase", "chase"},
		{"punctuation and case normalize", "WELLS-FARGO", "", "", "wells-fargo"},
		{"multi token alias inside a longer manual name", "", "", "Bank of America checking", "bank-of-america"},
		{"partial token never matches", "", "", "chasex", ""},
		{"substring never matches", "", "", "notpaypal", ""},
		{"american alone is not an issuer", "American Savings", "", "", ""},
		{"network does not override issuer", "Chase Visa Signature", "", "", "chase"},
		{"network alone is unknown", "Visa", "Mastercard", "", ""},
		{"unsupported brand falls back", "Capital One", "Citi", "Amazon", ""},
		{"ambiguous institution is decisive unknown", "Chase PayPal", "Klarna", "", ""},
		{"ambiguous manual name is unknown", "", "", "Venmo Klarna", ""},
		{"empty names unknown", "", "", "", ""},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := Recognize(test.institution, test.synced, test.own); got != test.want {
				t.Fatalf("Recognize(%q,%q,%q) = %q, want %q", test.institution, test.synced, test.own, got, test.want)
			}
		})
	}
}

func TestCuratedManifest(t *testing.T) {
	assets := Assets()
	if len(assets) != len(logoSpecs) || len(Keys()) != len(logoSpecs) {
		t.Fatalf("manifest has %d assets and %d keys for %d specs", len(assets), len(Keys()), len(logoSpecs))
	}
	for _, key := range Keys() {
		asset, ok := Lookup(key)
		if !ok || asset.Key != key || asset.Size <= 0 || asset.ContentType != "image/svg+xml" {
			t.Fatalf("incomplete asset for %q: %+v %v", key, asset, ok)
		}
		if !IsCatalogKey(key) || IsCatalogKey(key+"/../secret") {
			t.Fatalf("key validation failed for %q", key)
		}
		if !strings.HasPrefix(asset.ObjectKey, "businesslogo_"+key+"_") || len(asset.Version) != 64 {
			t.Fatalf("asset %q has an unexpected object key or version", key)
		}
		data, err := logoFiles.ReadFile("logos/" + asset.File)
		if err != nil || int64(len(data)) != asset.Size {
			t.Fatalf("embedded bytes for %q: %d %v", key, len(data), err)
		}
	}
	assets["chase"] = Asset{Key: "mutated"}
	if original, ok := Lookup("chase"); !ok || original.Version == "" {
		t.Fatal("mutating Assets() changed the manifest")
	}
}

func TestValidateSVGRejectsActiveContent(t *testing.T) {
	for _, payload := range []string{
		"",
		"not an svg",
		`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg>`,
		`<svg><use href="#x"/></svg>`,
		`<svg><style>@import url(https://example.com)</style></svg>`,
		strings.Repeat("x", maxLogoBytes+1),
	} {
		if err := validateSVG([]byte(payload)); err == nil {
			t.Fatalf("accepted unsafe payload %q", payload[:min(len(payload), 30)])
		}
	}
	valid, err := logoFiles.ReadFile("logos/chase.svg")
	if err != nil || validateSVG(valid) != nil {
		t.Fatalf("rejected curated asset: %v", err)
	}
}

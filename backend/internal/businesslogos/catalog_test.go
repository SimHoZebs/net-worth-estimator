package businesslogos

import (
	"bytes"
	"image"
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
		{"unsupported brand falls back", "Local Credit Union", "Amazon", "", ""},
		{"ambiguous institution is decisive unknown", "Chase PayPal", "Klarna", "", ""},
		{"ambiguous manual name is unknown", "", "", "Venmo Klarna", ""},
		{"exact user phrase", "", "", "Fidelity Investments", "fidelity-investments"},
		{"mixed case and punctuation", "FIDELITY-INVESTMENTS", "", "", "fidelity-investments"},
		{"bridge institution brokerage services", "Fidelity Brokerage Services", "", "", "fidelity-investments"},
		{"bridge synced netbenefits", "Local Bank", "Fidelity NetBenefits", "", "fidelity-investments"},
		{"synced netbenefits alone", "", "NetBenefits", "", "fidelity-investments"},
		{"manual ira", "", "", "Fidelity IRA", "fidelity-investments"},
		{"manual 401k", "", "", "Fidelity 401(k) Rollover", "fidelity-investments"},
		{"manual brokerage", "", "", "Fidelity Investments brokerage", "fidelity-investments"},
		{"bare fidelity is ambiguous", "Fidelity", "", "", ""},
		{"Fidelity Bank is unrelated", "Fidelity Bank", "", "", ""},
		{"Fidelity International is unrelated", "Fidelity International", "", "", ""},
		{"high fidelity is unrelated", "", "", "High Fidelity Savings", ""},
		{"fidelity plus another business is ambiguous", "Fidelity Investments Chase", "", "", ""},
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

func TestRecognizeExpandedUSBankCatalog(t *testing.T) {
	cases := []struct {
		name                     string
		institution, synced, own string
		want                     string
	}{
		// Capital One needs the whole phrase; neither word stands alone.
		{"capital one institution", "Capital One", "", "", "capital-one"},
		{"capital one bank synced", "", "Capital One Bank", "", "capital-one"},
		{"capital one financial manual", "", "", "Capital One Financial checking", "capital-one"},
		{"capitalone concatenated", "", "", "CapitalOne 360", "capital-one"},
		{"capital alone is not capital one", "Capital Savings", "", "", ""},
		{"one alone is not capital one", "One Bank", "", "", ""},
		{"capital one embedded substring", "", "", "mycapital one account", ""},
		// Citi's short name is distinctive; "city" is a different token.
		{"citi institution", "Citi", "", "", "citi"},
		{"citibank synced", "", "Citibank N.A.", "", "citi"},
		{"citigroup manual", "", "", "Citigroup checking", "citi"},
		{"city bank is not citi", "City Bank", "", "", ""},
		// Both punctuation forms of U.S. Bank and U.S. Bancorp are supported.
		{"us bank institution", "US Bank", "", "", "us-bank"},
		{"u s bank punctuation", "U.S. Bank", "", "", "us-bank"},
		{"us bancorp synced", "", "US Bancorp", "", "us-bank"},
		{"u s bancorp punctuation", "", "U.S. Bancorp", "", "us-bank"},
		{"us alone is not a business", "US", "", "", ""},
		{"bank alone is not a business", "Bank", "", "", ""},
		{"us treasury is not us bank", "US Treasury", "", "", ""},
		// Distinctive initialisms and names match on whole tokens.
		{"pnc institution", "PNC", "", "", "pnc"},
		{"pnc bank synced", "", "PNC Bank", "", "pnc"},
		{"truist financial manual", "", "", "Truist Financial checking", "truist"},
		{"truist bank institution", "Truist Bank", "", "", "truist"},
		{"bmo harris institution", "BMO Harris Bank", "", "", "bmo"},
		{"bank of montreal manual", "", "", "Bank of Montreal savings", "bmo"},
		// Ally is an ordinary word and needs a qualifier.
		{"ally bank institution", "Ally Bank", "", "", "ally"},
		{"ally financial synced", "", "Ally Financial", "", "ally"},
		{"ally alone is not a business", "Ally", "", "", ""},
		{"trusted ally is not ally bank", "", "", "Trusted Ally Credit Union", ""},
		// Existing conflict semantics still apply to the expanded catalog.
		{"capital one beats later manual", "Capital One", "Citi", "Chase", "capital-one"},
		{"two new brands are ambiguous", "US Bank Capital One", "", "", ""},
		{"new plus existing brand is ambiguous", "", "", "Ally Bank Chase", ""},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := Recognize(test.institution, test.synced, test.own); got != test.want {
				t.Fatalf("Recognize(%q,%q,%q) = %q, want %q", test.institution, test.synced, test.own, got, test.want)
			}
		})
	}
}

func TestExpandedCatalogAssetsAreStaticMonochromeSVG(t *testing.T) {
	keys := []string{"ally", "bmo", "capital-one", "citi", "pnc", "truist", "us-bank"}
	for _, key := range keys {
		asset, ok := Lookup(key)
		if !ok {
			t.Fatalf("expanded catalog key %q is missing", key)
		}
		if asset.ContentType != svgLogoType || asset.LicenseURL != "" {
			t.Fatalf("asset %q = %+v", key, asset)
		}
		data, err := logoFiles.ReadFile("logos/" + asset.File)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateSVG(data); err != nil {
			t.Fatalf("asset %q is not a static SVG: %v", key, err)
		}
		text := strings.ToLower(string(data))
		for _, forbidden := range []string{"fill=\"#", "fill='#", "fill=\"rgb", "stroke=\"#", "opacity=\""} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("asset %q contains color or opacity %q", key, forbidden)
			}
		}
	}
}

func TestCuratedManifest(t *testing.T) {
	assets := Assets()
	if len(assets) != len(logoSpecs) || len(Keys()) != len(logoSpecs) {
		t.Fatalf("manifest has %d assets and %d keys for %d specs", len(assets), len(Keys()), len(logoSpecs))
	}
	for _, spec := range logoSpecs {
		key := spec.key
		asset, ok := Lookup(key)
		wantType := svgLogoType
		if spec.format == pngLogo {
			wantType = pngLogoType
		}
		if !ok || asset.Key != key || asset.Size <= 0 || asset.ContentType != wantType {
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
		if _, err := validateLogo(data, spec.format); err != nil {
			t.Fatalf("curated asset %q failed validation: %v", key, err)
		}
	}
	assets["chase"] = Asset{Key: "mutated"}
	if original, ok := Lookup("chase"); !ok || original.Version == "" {
		t.Fatal("mutating Assets() changed the manifest")
	}
}

func TestCuratedFidelityAsset(t *testing.T) {
	asset, ok := Lookup("fidelity-investments")
	if !ok {
		t.Fatal("Fidelity Investments is not in the manifest")
	}
	if asset.ContentType != pngLogoType || asset.File != "fidelityinvestments.png" {
		t.Fatalf("Fidelity asset = %+v", asset)
	}
	if asset.LicenseURL != "https://creativecommons.org/licenses/by-sa/4.0/" {
		t.Fatalf("Fidelity license = %q", asset.LicenseURL)
	}
	for _, key := range Keys() {
		other, _ := Lookup(key)
		if key != "fidelity-investments" && other.LicenseURL != "" {
			t.Fatalf("unexpected license URL on CC0 asset %q", key)
		}
	}
	data, err := logoFiles.ReadFile("logos/" + asset.File)
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePNG(data); err != nil {
		t.Fatalf("curated Fidelity PNG is invalid: %v", err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != "png" || config.Width < 16 || config.Height < 16 || config.Width > 64 || config.Height > 64 {
		t.Fatalf("Fidelity PNG config = %+v %q %v", config, format, err)
	}
}

func TestValidatePNGRejectsWrongTypesAndSizes(t *testing.T) {
	for _, payload := range []string{
		"",
		"not a png",
		`<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
		"GIF89a" + strings.Repeat("x", 32),
		strings.Repeat("x", maxLogoBytes+1),
	} {
		if err := validatePNG([]byte(payload)); err == nil {
			t.Fatalf("accepted invalid PNG payload %q", payload[:min(len(payload), 24)])
		}
	}
	// Correct signature but no decodable image dimensions.
	if err := validatePNG([]byte(pngFileSignature + strings.Repeat("x", 64))); err == nil {
		t.Fatal("accepted a truncated PNG")
	}
	valid, err := logoFiles.ReadFile("logos/fidelityinvestments.png")
	if err != nil || validatePNG(valid) != nil {
		t.Fatalf("rejected curated PNG: %v", err)
	}
	if _, err := validateLogo(valid, svgLogo); err == nil {
		t.Fatal("PNG accepted as SVG")
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

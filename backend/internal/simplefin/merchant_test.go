package simplefin

import "testing"

func TestMerchantNamesMatch(t *testing.T) {
	tests := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{
			name: "authorization noise around a merchant",
			a:    "LYFT *TEMP AUTH HOLD",
			b:    "LYFT *STANDARD 10-30",
			want: true,
		},
		{
			name: "exact descriptor",
			a:    "Bistro",
			b:    "Bistro",
			want: true,
		},
		{
			name: "descriptor containment",
			a:    "The Bistro",
			b:    "Bistro",
			want: true,
		},
		{
			name: "posted branch adds a token",
			a:    "Bistro",
			b:    "Bistro Uptown",
			want: true,
		},
		{
			name: "different branches stay apart",
			a:    "Bistro Uptown",
			b:    "Bistro Downtown",
			want: false,
		},
		{
			name: "square processor prefix",
			a:    "SQ *Blue Bottle",
			b:    "Blue Bottle Coffee",
			want: true,
		},
		{
			name: "toast processor prefix",
			a:    "TST* The Bistro",
			b:    "The Bistro",
			want: true,
		},
		{
			name: "paypal processor prefix",
			a:    "PAYPAL *Spotify",
			b:    "Spotify USA",
			want: true,
		},
		{
			name: "store number differs",
			a:    "Corner Store 1234",
			b:    "Corner Store 5678",
			want: true,
		},
		{
			name: "amazon abbreviation",
			a:    "AMZN MKTP US*2A3B4C5D3",
			b:    "AMAZON MKTPLACE PMTS AMZN.COM/BILL WA",
			want: true,
		},
		{
			name: "different merchants",
			a:    "Bistro",
			b:    "Pizza Place",
			want: false,
		},
		{
			name: "empty descriptor",
			a:    "",
			b:    "Bistro",
			want: false,
		},
		{
			name: "noise only",
			a:    "TEMP AUTH HOLD",
			b:    "PENDING AUTH",
			want: false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := merchantNamesMatch(test.a, test.b); got != test.want {
				t.Fatalf("merchantNamesMatch(%q, %q) = %v, want %v", test.a, test.b, got, test.want)
			}
		})
	}
}

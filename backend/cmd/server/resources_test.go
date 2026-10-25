package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestResourceConfigurationRequiresExplicitSafePathsAndOwner(t *testing.T) {
	base := filepath.Join(t.TempDir(), "primary.db")
	c, err := resourceConfigFromEnv(func(string) string { return "" }, base)
	if err != nil || c.OwnerSubject != "" || c.PrivateDir != base+".plans" || c.SampleDB != "" {
		t.Fatalf("unexpected defaults: %+v %v", c, err)
	}
	for key, value := range map[string]string{
		"NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT": "*",
		"NET_WORTH_ESTIMATOR_PLANS_DIR":          "relative/plans",
		"NET_WORTH_ESTIMATOR_SAMPLE_DB":          "relative/sample.db",
	} {
		_, err := resourceConfigFromEnv(func(name string) string {
			if name == key {
				return value
			}
			return ""
		}, base)
		if err == nil {
			t.Errorf("accepted invalid %s", key)
		}
	}
	for _, test := range []struct {
		value string
		want  time.Duration
		ok    bool
	}{
		{"", 0, true},
		{"45s", 45 * time.Second, true},
		{"-1s", -time.Second, true},
		{"bogus", 0, false},
	} {
		c, err := resourceConfigFromEnv(func(name string) string {
			if name == "NET_WORTH_ESTIMATOR_WARM_DEBOUNCE" {
				return test.value
			}
			return ""
		}, base)
		if test.ok {
			if err != nil || c.WarmDebounce != test.want {
				t.Errorf("warm debounce %q = %v, %v; want %v, nil", test.value, c.WarmDebounce, err, test.want)
			}
		} else if err == nil {
			t.Errorf("accepted invalid warm debounce %q", test.value)
		}
	}
}

package main

import (
	"path/filepath"
	"testing"
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
}

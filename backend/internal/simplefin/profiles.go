package simplefin

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

//go:embed profiles.json
var profileData []byte

// settleProfile is the settlement behavior class for one merchant. The
// manifest is data, not a script: every field is a bounded policy knob the
// matcher already understands.
type settleProfile struct {
	WindowDays  int     `json:"windowDays"`
	AmountMode  string  `json:"amountMode"`
	MinRatio    float64 `json:"minRatio"`
	MaxRatio    float64 `json:"maxRatio"`
	FloorCents  int64   `json:"floorCents"`
	CapCents    int64   `json:"capCents"`
	Capture     string  `json:"capture"`
	AutoConvert bool    `json:"autoConvert"`
}

type settleProfileSet struct {
	Version   int                      `json:"version"`
	Default   settleProfile            `json:"default"`
	Profiles  map[string]settleProfile `json:"profiles"`
	Merchants map[string]string        `json:"merchants"`
}

var settleProfiles = mustLoadProfiles(profileData)

func mustLoadProfiles(raw []byte) settleProfileSet {
	var set settleProfileSet
	if err := json.Unmarshal(raw, &set); err != nil {
		panic(fmt.Sprintf("load settlement profiles: %v", err))
	}
	if err := validateProfiles(set); err != nil {
		panic(fmt.Sprintf("validate settlement profiles: %v", err))
	}
	return set
}

func validateProfile(name string, profile settleProfile) error {
	if profile.WindowDays <= 0 {
		return fmt.Errorf("%s: windowDays must be positive", name)
	}
	switch profile.AmountMode {
	case "bounded":
		if profile.MinRatio <= 0 || profile.MaxRatio < profile.MinRatio {
			return fmt.Errorf("%s: bounded amount needs 0 < minRatio <= maxRatio", name)
		}
	case "floor":
		if profile.CapCents <= 0 {
			return fmt.Errorf("%s: floor amount needs a positive capCents", name)
		}
	case "exact":
		// allowsAmount compares cents exactly.
	case "any":
		if profile.AutoConvert {
			return fmt.Errorf("%s: any amount mode cannot auto-convert", name)
		}
	default:
		return fmt.Errorf("%s: unknown amount mode %q", name, profile.AmountMode)
	}
	if profile.FloorCents < 0 || profile.CapCents < 0 {
		return fmt.Errorf("%s: floorCents and capCents must be non-negative", name)
	}
	switch profile.Capture {
	case "one-to-one", "one-to-many", "many-to-one":
	default:
		return fmt.Errorf("%s: unknown capture mode %q", name, profile.Capture)
	}
	if profile.Capture != "one-to-one" && profile.AutoConvert {
		return fmt.Errorf("%s: capture mode %s cannot auto-convert", name, profile.Capture)
	}
	return nil
}

func validateProfiles(set settleProfileSet) error {
	if set.Version != 1 {
		return fmt.Errorf("version %d, want 1", set.Version)
	}
	if err := validateProfile("default", set.Default); err != nil {
		return err
	}
	for name, profile := range set.Profiles {
		if err := validateProfile(name, profile); err != nil {
			return err
		}
	}
	for merchant, name := range set.Merchants {
		if merchant == "" || merchant != strings.ToUpper(merchant) {
			return fmt.Errorf("merchant key %q must be uppercase", merchant)
		}
		if _, ok := set.Profiles[name]; !ok {
			return fmt.Errorf("merchant %s references unknown profile %s", merchant, name)
		}
	}
	return nil
}

// profileForTransaction picks the behavior class from the merchant key. An
// unknown merchant gets the conservative default, never a guessed class.
func profileForTransaction(transaction types.Transaction) settleProfile {
	for _, token := range merchantKey(transaction.Name) {
		if name, ok := settleProfiles.Merchants[token]; ok {
			if profile, ok := settleProfiles.Profiles[name]; ok {
				return profile
			}
		}
	}
	return settleProfiles.Default
}

func (profile settleProfile) windowSeconds() int64 {
	return int64(profile.WindowDays) * 24 * 3600
}

func (profile settleProfile) allowsAmount(authCents, postedCents int64) bool {
	switch profile.AmountMode {
	case "exact":
		return postedCents == authCents
	case "floor":
		return postedCents >= authCents-profile.FloorCents && postedCents <= profile.CapCents
	case "any":
		return true
	default:
		lowerTolerance := int64(float64(authCents) * (1 - profile.MinRatio))
		upperTolerance := int64(float64(authCents) * (profile.MaxRatio - 1))
		if lowerTolerance < profile.FloorCents {
			lowerTolerance = profile.FloorCents
		}
		if upperTolerance < profile.FloorCents {
			upperTolerance = profile.FloorCents
		}
		if lowerTolerance > profile.CapCents {
			lowerTolerance = profile.CapCents
		}
		if upperTolerance > profile.CapCents {
			upperTolerance = profile.CapCents
		}
		return postedCents >= authCents-lowerTolerance && postedCents <= authCents+upperTolerance
	}
}

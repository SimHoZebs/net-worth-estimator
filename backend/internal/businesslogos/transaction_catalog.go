package businesslogos

import (
	"maps"
	"strings"
)

// Only these public domains can be sent to Logo.dev. Merchant aliases are
// matched locally. A leading "=" matches the whole normalized source, for
// brand names such as Lime that are ordinary words in other contexts.
var providerMerchants = []struct {
	key     string
	domain  string
	aliases []string
}{
	{"amazon", "amazon.com", []string{"amazon", "amzn"}},
	{"lime", "li.me", []string{"=lime", "limebike", "neutron holdings", "lime ride", "lim ride cost", "limeride cost", "lime temp hold", "lim temp hold", "lime subscription cost", "lim subscription cost", "lime add balance", "lim add balance", "lime restore balance", "lim restore balance", "lime scooters"}},

	{"aeromexico", "aeromexico.com", []string{"aeromexico", "aeroméxico"}},
	{"air-canada", "aircanada.com", []string{"air canada"}},
	{"air-china", "airchina.com.cn", []string{"air china"}},
	{"air-france", "airfrance.com", []string{"air france"}},
	{"air-india", "airindia.com", []string{"air india"}},
	{"air-new-zealand", "airnewzealand.com", []string{"air new zealand"}},
	{"alaska-airlines", "alaskaair.com", []string{"alaska airlines"}},
	{"american-airlines", "aa.com", []string{"american airlines", "american air lines"}},
	{"ana", "ana.co.jp", []string{"all nippon airways", "ana airlines"}},
	{"avianca", "avianca.com", []string{"avianca"}},
	{"british-airways", "britishairways.com", []string{"british airways"}},
	{"cathay-pacific", "cathaypacific.com", []string{"cathay pacific"}},
	{"china-eastern-airlines", "ceair.com", []string{"china eastern airlines"}},
	{"china-southern-airlines", "csair.com", []string{"china southern airlines"}},
	{"copa-airlines", "copaair.com", []string{"copa airlines"}},
	{"delta", "delta.com", []string{"delta air lines", "delta airlines"}},
	{"easyjet", "easyjet.com", []string{"easyjet"}},
	{"emirates", "emirates.com", []string{"emirates"}},
	{"ethiopian-airlines", "ethiopianairlines.com", []string{"ethiopian airlines"}},
	{"etihad-airways", "etihad.com", []string{"etihad airways"}},
	{"finnair", "finnair.com", []string{"finnair"}},
	{"frontier-airlines", "flyfrontier.com", []string{"frontier airlines"}},
	{"hawaiian-airlines", "hawaiianairlines.com", []string{"hawaiian airlines"}},
	{"iberia", "iberia.com", []string{"=iberia", "iberia airlines"}},
	{"japan-airlines", "jal.co.jp", []string{"japan airlines", "jal airlines"}},
	{"jetblue", "jetblue.com", []string{"jetblue"}},
	{"klm", "klm.com", []string{"klm"}},
	{"korean-air", "koreanair.com", []string{"korean air"}},
	{"latam-airlines", "latamairlines.com", []string{"latam airlines"}},
	{"lot-polish-airlines", "lot.com", []string{"lot polish airlines", "lot airlines"}},
	{"lufthansa", "lufthansa.com", []string{"lufthansa"}},
	{"pegasus-airlines", "flypgs.com", []string{"pegasus airlines"}},
	{"qantas", "qantas.com", []string{"qantas"}},
	{"qatar-airways", "qatarairways.com", []string{"qatar airways"}},
	{"ryanair", "ryanair.com", []string{"ryanair"}},
	{"s7-airlines", "s7.ru", []string{"s7 airlines"}},
	{"singapore-airlines", "singaporeair.com", []string{"singapore airlines"}},
	{"southwest-airlines", "southwest.com", []string{"southwest airlines"}},
	{"spirit-airlines", "spirit.com", []string{"spirit airlines"}},
	{"swiss", "swiss.com", []string{"swiss international air lines", "swiss airlines"}},
	{"tap-air-portugal", "flytap.com", []string{"tap air portugal", "tap portugal"}},
	{"turkish-airlines", "turkishairlines.com", []string{"turkish airlines"}},
	{"united-airlines", "united.com", []string{"united airlines", "united air lines"}},
	{"virgin-atlantic", "virginatlantic.com", []string{"virgin atlantic"}},
	{"westjet", "westjet.com", []string{"westjet"}},
	{"wizz-air", "wizzair.com", []string{"wizz air", "wizzair"}},

	{"burger-king", "bk.com", []string{"burger king", "burgerking"}},
	{"chick-fil-a", "chick-fil-a.com", []string{"chick fil a", "chickfila"}},
	{"chipotle", "chipotle.com", []string{"=chipotle", "chipotle mexican grill"}},
	{"dominos", "dominos.com", []string{"domino's pizza", "dominos pizza", "=domino's", "=dominos"}},
	{"five-guys", "fiveguys.com", []string{"five guys", "fiveguys"}},
	{"in-n-out", "in-n-out.com", []string{"in n out burger", "in n out burgers", "=in n out"}},
	{"kfc", "kfc.com", []string{"kfc", "kentucky fried chicken"}},
	{"mcdonalds", "mcdonalds.com", []string{"mcdonald's", "mcdonalds"}},
	{"panda-express", "pandaexpress.com", []string{"panda express", "pandaexpress"}},
	{"pizza-hut", "pizzahut.com", []string{"pizza hut", "pizzahut"}},
	{"popeyes", "popeyes.com", []string{"popeyes", "popeye's"}},
	{"starbucks", "starbucks.com", []string{"starbucks"}},
	{"subway", "subway.com", []string{"=subway", "subway restaurant", "subway sandwiches"}},
	{"taco-bell", "tacobell.com", []string{"taco bell", "tacobell"}},
	{"wendys", "wendys.com", []string{"wendy's", "wendys"}},
}

var logoDevDomains = func() map[string]string {
	domains := make(map[string]string, len(providerMerchants))
	for _, entry := range providerMerchants {
		domains[entry.key] = entry.domain
	}
	return domains
}()

// LogoDevDomains returns the public domain allowlist for offline logo imports.
func LogoDevDomains() map[string]string {
	return maps.Clone(logoDevDomains)
}

func providerBusinesses() []business {
	entries := make([]business, 0, len(providerMerchants))
	for _, merchant := range providerMerchants {
		entry := business{key: merchant.key, aliases: make([]alias, 0, len(merchant.aliases))}
		for _, name := range merchant.aliases {
			phrase, exact := strings.CutPrefix(name, "=")
			entry.aliases = append(entry.aliases, alias{
				tokens: normalize(phrase), transaction: true, exact: exact,
			})
		}
		entries = append(entries, entry)
	}
	return entries
}

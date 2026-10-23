package game

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed catalog.json
var catalogData []byte

var russianNames = func() map[string]string {
	var c Catalog
	_ = json.Unmarshal(catalogData, &c)
	names := map[string]string{}
	for _, d := range c {
		names[d.StableKey()+"/"+d.Name] = d.NameRu
	}
	return names
}()

// DefaultCatalog is data, not executable JavaScript. Order remains compatible
// with existing rooms; stable keys are used by newly saved deck documents.
func DefaultCatalog() (Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(catalogData, &c); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, d := range c {
		if d.Key == "" || d.NameRu == "" || seen[d.Key] {
			return nil, fmt.Errorf("invalid catalog entry %q", d.Name)
		}
		seen[d.Key] = true
	}
	return c, c.Valid()
}

func (d Definition) StableKey() string {
	if d.Key != "" {
		return d.Key
	}
	return d.Deck + "." + d.Filename
}
func (d Definition) RussianName() string {
	if d.NameRu != "" {
		return d.NameRu
	}
	// Legacy/custom catalogs retain their rules names. The shipped catalog is
	// always fully translated, including when loaded via CARDS_FILE=cards.js.
	if name := russianNames[d.StableKey()+"/"+d.Name]; name != "" {
		return name
	}
	return d.Name
}
func (d Definition) Artwork() string { return "/img/sm/" + d.Deck + "_" + d.Filename + ".jpg" }

var AbilityDescriptions = map[string]string{
	"hero":          "Герой. Не подвержен погоде, казни, приманке и усилениям других карт.",
	"spy":           "Шпион. Размещается на стороне противника и позволяет взять две карты из своей колоды.",
	"muster":        "Двойник. Призывает связанные карты из руки и колоды в их боевые ряды.",
	"bond":          "Прочная связь. Сила одинаковых отрядов в одном ряду умножается на их количество.",
	"morale":        "Прилив сил. Усиливает каждый другой негероический отряд своего ряда на 1.",
	"medic":         "Медик. Возвращает выбранный негероический отряд из сброса на поле. Может продолжить цепочку медиков.",
	"horn":          "Командирский рог. Удваивает силу остальных негероических отрядов ряда. Рога не складываются.",
	"decoy":         "Приманка. Возвращает выбранный негероический отряд со своего поля в руку и занимает его место.",
	"scorch":        "Казнь. Уничтожает сильнейшие негероические отряды на всём поле, включая ваши.",
	"scorch_c":      "Казнь ближнего ряда. Уничтожает сильнейшие негероические отряды в ближнем ряду противника, если сила ряда не меньше 10.",
	"scorch_r":      "Казнь дальнего ряда. Уничтожает сильнейшие негероические отряды в дальнем ряду противника, если сила ряда не меньше 10.",
	"scorch_s":      "Казнь осадного ряда. Уничтожает сильнейшие негероические отряды в осадном ряду противника, если сила ряда не меньше 10.",
	"frost":         "Мороз. Снижает базовую силу негероических отрядов ближнего боя до 1 с обеих сторон.",
	"fog":           "Мгла. Снижает базовую силу негероических отрядов дальнего боя до 1 с обеих сторон.",
	"rain":          "Дождь. Снижает базовую силу негероических осадных отрядов до 1 с обеих сторон.",
	"storm":         "Шторм. Применяет мглу и дождь к дальним и осадным рядам обоих игроков.",
	"clear":         "Ясная погода. Снимает все погодные эффекты с поля.",
	"berserker":     "Берсерк. Под действием мардрёма превращается в вильдкаарла.",
	"mardroeme":     "Мардрём. Превращает берсерков своего ряда в вильдкаарлов, в том числе сыгранных позже.",
	"avenger":       "Мститель. При удалении коровы с поля призывает Силы бычьей обороны.",
	"avenger_kambi": "Мститель. При удалении Камби с поля призывает Хеймдалля.",
	"vildkarrl":     "Преображённый берсерк.",
}

func (d Definition) Description() string   { return d.description(false) }
func (d Definition) DescriptionEn() string { return d.description(true) }
func (d Definition) description(english bool) string {
	var lines []string
	effects, leaders := AbilityDescriptions, supportedLeaders
	agile, plain := "Проворство. Можно сыграть в ближний или дальний ряд.", "Отряд без дополнительной способности."
	if english {
		effects, leaders = AbilityDescriptionsEnglish, LeaderDescriptionsEnglish
		agile, plain = "Agile. Can be placed in either the close combat or ranged row.", "Unit with no additional ability."
	}
	if d.Row == "agile" {
		lines = append(lines, agile)
	}
	for _, ability := range strings.Fields(d.Ability) {
		if d.Has("storm") && (ability == "rain" || ability == "fog") {
			continue
		}
		if text, ok := leaders[ability]; ok {
			lines = append(lines, strings.TrimSuffix(text, ".")+".")
		} else if text, ok := effects[ability]; ok {
			lines = append(lines, text)
		}
	}
	if len(lines) == 0 {
		return plain
	}
	return strings.Join(lines, " ")
}

func ResolveDeck(c Catalog, entries []DeckEntry) ([]DeckEntry, error) {
	if entries == nil {
		return nil, nil
	}
	result := append([]DeckEntry{}, entries...)
	for n, e := range result {
		if e.Key == "" {
			continue
		}
		found := false
		for i, d := range c {
			if d.StableKey() == e.Key {
				result[n].Def = i
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown card key")
		}
	}
	return result, nil
}

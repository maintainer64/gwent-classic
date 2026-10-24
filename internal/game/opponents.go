package game

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed opponents.json
var opponentData []byte

type opponentDefinition struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Title       string      `json:"title"`
	Faction     string      `json:"faction"`
	LeaderKey   string      `json:"leaderKey"`
	PortraitKey string      `json:"portraitKey"`
	Style       string      `json:"style"`
	Description string      `json:"description"`
	Hint        string      `json:"hint"`
	Signature   []string    `json:"signature"`
	Deck        []DeckEntry `json:"deck"`
}

// Opponent exposes a known challenge deck, never a dealt hand or draw order.
type Opponent struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Title       string      `json:"title"`
	Faction     string      `json:"faction"`
	Leader      int         `json:"leader"`
	Image       string      `json:"image"`
	Style       string      `json:"style"`
	Description string      `json:"description"`
	Hint        string      `json:"hint"`
	Signature   []string    `json:"signature"`
	Deck        []DeckEntry `json:"deck"`
}

var opponentDefinitions = func() []opponentDefinition {
	var profiles []opponentDefinition
	if err := json.Unmarshal(opponentData, &profiles); err != nil {
		panic(err)
	}
	return profiles
}()

func findOpponent(id string) (opponentDefinition, bool) {
	for _, profile := range opponentDefinitions {
		if profile.ID == id {
			return profile, true
		}
	}
	return opponentDefinition{}, false
}

func resolveOpponent(id string, c Catalog) (Opponent, error) {
	profile, ok := findOpponent(id)
	if !ok {
		return Opponent{}, fmt.Errorf("unknown opponent %q", id)
	}
	deck, err := ResolveDeck(c, profile.Deck)
	if err != nil {
		return Opponent{}, err
	}
	if err := ValidateDeck(c, profile.Faction, deck); err != nil {
		return Opponent{}, err
	}
	leader, image := 0, ""
	for i, d := range c {
		if d.StableKey() == profile.LeaderKey && d.Row == "leader" && d.Deck == profile.Faction {
			leader = i + 1
		}
		if d.StableKey() == profile.PortraitKey {
			image = d.Artwork()
		}
	}
	if leader == 0 || image == "" {
		return Opponent{}, fmt.Errorf("incomplete opponent %q", id)
	}
	return Opponent{ID: profile.ID, Name: profile.Name, Title: profile.Title, Faction: profile.Faction,
		Leader: leader, Image: image, Style: profile.Style, Description: profile.Description, Hint: profile.Hint,
		Signature: append([]string(nil), profile.Signature...), Deck: deck}, nil
}

func OpponentCatalog(c Catalog) []Opponent {
	profiles := make([]Opponent, 0, len(opponentDefinitions))
	for _, definition := range opponentDefinitions {
		// Custom/legacy catalogues may omit cards used by these challenges.
		if profile, err := resolveOpponent(definition.ID, c); err == nil {
			profiles = append(profiles, profile)
		}
	}
	return profiles
}

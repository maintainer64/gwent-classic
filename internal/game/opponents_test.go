package game

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func deckCounts(cards []Card) map[int]int {
	out := map[int]int{}
	for _, card := range cards {
		out[card.Def]++
	}
	return out
}

func profileCounts(profile Opponent) map[int]int {
	out := map[int]int{}
	for _, card := range profile.Deck {
		out[card.Def] = card.Count
	}
	return out
}

func TestTwelveOpponentDecksAreLegalDistinctAndComplete(t *testing.T) {
	c := realCatalog(t)
	profiles := OpponentCatalog(c)
	if len(profiles) != 12 || len(opponentDefinitions) != 12 {
		t.Fatalf("expected 12 complete profiles, got %d", len(profiles))
	}
	seen, decks, factions := map[string]bool{}, map[string]bool{}, map[string]int{}
	for _, p := range profiles {
		if seen[p.ID] || p.Name == "" || p.Title == "" || p.Description == "" || p.Hint == "" {
			t.Fatalf("incomplete/duplicate profile: %+v", p)
		}
		seen[p.ID] = true
		factions[p.Faction]++
		if err := ValidateDeck(c, p.Faction, p.Deck); err != nil {
			t.Fatal(p.ID, err)
		}
		units := 0
		for _, entry := range p.Deck {
			if c[entry.Def].Deck != "weather" && c[entry.Def].Deck != "special" {
				units += entry.Count
			}
		}
		if units != 22 {
			t.Fatalf("%s: %d units", p.ID, units)
		}
		data, _ := json.Marshal(profileCounts(p))
		if decks[string(data)] {
			t.Fatalf("duplicate deck: %s", p.ID)
		}
		decks[string(data)] = true
		if _, err := os.Stat(filepath.Join("..", "..", strings.TrimPrefix(p.Image, "/"))); err != nil {
			t.Fatalf("%s portrait: %v", p.ID, err)
		}
		for _, key := range p.Signature {
			found := false
			for _, entry := range p.Deck {
				if entry.Key == key {
					found = true
				}
			}
			if !found {
				t.Fatalf("%s signature %s isn't in deck", p.ID, key)
			}
		}
		for _, difficulty := range []BotDifficulty{BotNormal, BotHard} {
			r, err := NewRoomConfigured("OPPONENTABCD", "bot", "human", "Игрок", "realms", c, time.Now(), 0, BotOptions{DeckMode: BotOpponent, Opponent: p.ID, Difficulty: difficulty})
			if err != nil {
				t.Fatal(p.ID, err)
			}
			if r.Players[1].Name != p.Name || r.Players[1].Leader != p.Leader || r.Bot.Style != p.Style || r.Bot.Opponent != p.ID {
				t.Fatalf("wrong opponent: %+v", r.Bot)
			}
			if !reflect.DeepEqual(deckCounts(r.Players[1].StartingDeck), profileCounts(p)) {
				t.Fatal("preset changed during setup", p.ID)
			}
			view, _ := json.Marshal(r.Project(0, c))
			for _, card := range r.Players[1].Hand {
				if strings.Contains(string(view), card.UID) {
					t.Fatal("dealt hand leaked through public profile")
				}
			}
		}
	}
	if len(factions) != len(Factions) {
		t.Fatal("missing a faction")
	}
}

func TestOpponentRejectsForgedDeckLeaderAndIdentity(t *testing.T) {
	c := realCatalog(t)
	for _, options := range []BotOptions{
		{DeckMode: BotOpponent, Opponent: "missing"},
		{DeckMode: BotOpponent, Opponent: "geralt", Faction: "nilfgaard"},
		{DeckMode: BotOpponent, Opponent: "geralt", Leader: 1},
		{DeckMode: BotOpponent, Opponent: "geralt", Deck: []DeckEntry{{Key: "neutral.geralt", Count: 10}}},
		{DeckMode: BotRandom, Opponent: "geralt"},
	} {
		if _, err := NewRoomConfigured("OPPONENTABCD", "bot", "human", "Игрок", "realms", c, time.Now(), 0, options); err == nil {
			t.Fatalf("accepted forged preset: %+v", options)
		}
	}
}

func TestOpponentRematchAndReloadKeepExactDeckAndCharacter(t *testing.T) {
	c := realCatalog(t)
	for _, profile := range OpponentCatalog(c) {
		r, err := NewRoomConfigured("OPPONENTABCD", "bot", "human", "Игрок", "realms", c, time.Now(), 0, BotOptions{DeckMode: BotOpponent, Opponent: profile.ID, Difficulty: BotHard})
		if err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(r)
		var restored Room
		if err := json.Unmarshal(data, &restored); err != nil {
			t.Fatal(err)
		}
		restored.Status = "finished"
		if err := restored.requestRematch(0, c); err != nil {
			t.Fatal(err)
		}
		if restored.Bot.Opponent != profile.ID || restored.Players[1].Name != profile.Name || restored.Players[1].Leader != profile.Leader {
			t.Fatal("rematch lost opponent", profile.ID)
		}
		if !reflect.DeepEqual(deckCounts(restored.Players[1].StartingDeck), profileCounts(profile)) {
			t.Fatal("rematch randomized deck", profile.ID)
		}
	}
}

func TestAllNamedOpponentsCompleteLegalMatches(t *testing.T) {
	c := realCatalog(t)
	for _, profile := range OpponentCatalog(c) {
		t.Run(profile.ID, func(t *testing.T) {
			r, err := NewRoomWithDeck("OPPONENTABCD", "bot", "human", "Игрок", profile.Faction, c, time.Now(), 0,
				BotOptions{DeckMode: BotOpponent, Opponent: profile.ID, Difficulty: BotHard}, profile.Deck, profile.Leader)
			if err != nil {
				t.Fatal(err)
			}
			for step := 0; r.Status == "playing" && step < 200; step++ {
				var action Action
				switch {
				case r.Phase == "mulligan":
					action = Action{Type: "ready"}
				case r.Initiative == 1:
					action = Action{Type: "initiative", Target: "self"}
				default:
					if r.Turn != 0 && r.PendingOwner != 1 {
						t.Fatal("opponent stalled")
					}
					action = r.botDecision(0, c, BotNormal)
				}
				if err := r.Apply(0, action, c); err != nil {
					t.Fatalf("step %d: %+v: %v", step, action, err)
				}
			}
			if r.Status != "finished" {
				t.Fatal("match did not finish")
			}
		})
	}
}

package game

import (
	"errors"
	"strings"
	"time"
)

// Initial decks are server-only snapshots, captured before the opening draw.
// A rematch keeps identities, factions, leaders, bot settings and room timer.
func (r *Room) requestRematch(seat int, c Catalog) error {
	if seat < 0 || seat >= len(r.Players) || len(r.Players) != 2 {
		return errors.New("not a player")
	}
	if r.Status != "finished" {
		return errors.New("match is not finished")
	}
	if r.RematchReady[seat] {
		return nil
	}
	r.RematchReady[seat] = true
	if r.Mode == "bot" {
		r.RematchReady[1] = true
	}
	r.Version++
	if !r.RematchReady[0] || !r.RematchReady[1] {
		return nil
	}
	players := make([]Player, 2)
	for i, old := range r.Players {
		original := old.StartingDeck
		if len(original) == 0 {
			original = r.recoverOpeningDeck(i, c)
		}
		if len(original) == 0 {
			// Rooms saved by older releases did not retain opening decks. Keep
			// the opponent's faction/leader and custom setup when reconstructing.
			p, err := addPlayer(old.ID, old.Name, old.Faction, c, old.Leader)
			if err != nil {
				return err
			}
			if i == 1 && r.Bot != nil && r.Bot.DeckMode == BotCustom {
				if err := assignCustomDeck(&p, c, old.Faction, r.Bot.Deck); err != nil {
					return err
				}
			}
			original = p.Deck
		}
		deck := make([]Card, len(original))
		for j, card := range original {
			deck[j] = Card{UID: randomUID(), Def: card.Def}
		}
		shuffle(deck)
		players[i] = Player{ID: old.ID, Name: old.Name, Faction: old.Faction, Leader: old.Leader, Deck: deck,
			StartingDeck: append([]Card(nil), deck...), Rows: rows(), Special: rows(), Horn: map[string]bool{}, Mardroeme: map[string]bool{}}
	}
	r.Players = players
	r.RematchReady = [2]bool{}
	r.Weather, r.WeatherCards, r.RoundHistory, r.Events, r.Transitions = nil, nil, nil, nil, nil
	r.PendingOwner, r.Winner, r.Serial = 0, -1, 0
	r.TurnDeadline = time.Time{}
	if r.GameNumber < 1 {
		r.GameNumber = 1
	}
	r.GameNumber++
	r.start(c)
	return nil
}

// Older saves retain physical cards across all zones, but lack an opening snapshot.
func (r *Room) recoverOpeningDeck(seat int, c Catalog) []Card {
	p := r.Players[seat]
	cards := append(append(append([]Card{}, p.Deck...), p.Hand...), p.Grave...)
	for _, row := range []string{"close", "ranged", "siege"} {
		cards = append(cards, p.Rows[row]...)
		cards = append(cards, p.Special[row]...)
	}
	for _, placed := range r.WeatherCards {
		if placed.Owner == seat {
			cards = append(cards, placed.Card)
		}
	}
	seen, counts := map[string]bool{}, map[int]int{}
	var original []Card
	for _, card := range cards {
		if seen[card.UID] || card.Def < 0 || card.Def >= len(c) {
			continue
		}
		seen[card.UID] = true
		if strings.HasSuffix(card.UID, ":bear") {
			young := strings.Contains(c[card.Def].Name, "Young")
			for def, d := range c {
				if d.Has("berserker") && strings.Contains(d.Name, "Young") == young {
					card.Def = def
					break
				}
			}
		}
		d := c[card.Def]
		if d.Count == "0" || d.Row == "leader" || (d.Deck != p.Faction && d.Deck != "neutral" && d.Deck != "special" && d.Deck != "weather") {
			continue
		}
		card.Boost = 0
		original = append(original, card)
		counts[card.Def]++
	}
	var entries []DeckEntry
	for def, count := range counts {
		entries = append(entries, DeckEntry{Def: def, Count: count})
	}
	if ValidateDeck(c, p.Faction, entries) != nil {
		return nil
	}
	return original
}

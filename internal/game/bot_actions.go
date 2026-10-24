package game

func (r *Room) candidateActions(player int, c Catalog) []Action {
	p := r.Players[player]
	choices := []Action{}
	for _, card := range p.Hand {
		d := c[card.Def]
		if d.Has("decoy") {
			for _, row := range []string{"close", "ranged", "siege"} {
				for _, target := range p.Rows[row] {
					if isUnit(c[target.Def]) {
						choices = append(choices, Action{Type: "play", UID: card.UID, Target: target.UID})
					}
				}
			}
			continue
		}
		if d.Has("medic") && len(r.eligibleGrave(player, c)) > 0 && !r.randomRevival(c) {
			medicRows := []string{d.Row}
			if d.Row == "agile" {
				medicRows = []string{"close", "ranged"}
			}
			for _, row := range medicRows {
				for _, target := range r.eligibleGrave(player, c) {
					targetRows := []string{""}
					if c[target.Def].Row == "agile" {
						targetRows = []string{"close", "ranged"}
					}
					for _, targetRow := range targetRows {
						choices = append(choices, Action{Type: "play", UID: card.UID, Row: row, Target: target.UID, TargetRow: targetRow})
					}
				}
			}
			continue
		}
		targetRows := []string{d.Row}
		if d.Row == "agile" || (d.Deck == "special" && (d.Has("horn") || d.Has("mardroeme"))) {
			targetRows = []string{"close", "ranged", "siege"}
			if d.Row == "agile" {
				targetRows = []string{"close", "ranged"}
			}
		}
		for _, row := range targetRows {
			choices = append(choices, Action{Type: "play", UID: card.UID, Row: row})
		}
	}
	if !p.LeaderUsed {
		switch {
		case r.leaderHas(player, c, "emhyr_relentless"):
			for _, card := range r.eligibleGrave(1-player, c) {
				choices = append(choices, Action{Type: "leader", Target: card.UID})
			}
		case r.leaderHas(player, c, "eredin_bringer_of_death"):
			for _, card := range r.eligibleGrave(player, c) {
				choices = append(choices, Action{Type: "leader", Target: card.UID})
			}
		case r.leaderHas(player, c, "eredin_destroyer"):
			if len(p.Hand) >= 2 && len(p.Deck) > 0 {
				// Preserve abilities when choosing the fixed discard/draw candidate.
				discard := append([]Card(nil), p.Hand...)
				for i := range discard {
					for j := i + 1; j < len(discard); j++ {
						if r.botCardValue(player, discard[i], c) > r.botCardValue(player, discard[j], c) {
							discard[i], discard[j] = discard[j], discard[i]
						}
					}
				}
				draw := p.Deck[0]
				for _, card := range p.Deck {
					if r.botCardValue(player, card, c) > r.botCardValue(player, draw, c) {
						draw = card
					}
				}
				choices = append(choices, Action{Type: "leader", Targets: []string{discard[0].UID, discard[1].UID}, Draw: draw.UID})
			}
		case r.leaderHas(player, c, "eredin_king"):
			for _, card := range p.Deck {
				if c[card.Def].Deck == "weather" {
					choices = append(choices, Action{Type: "leader", Target: card.UID})
				}
			}
		default:
			choices = append(choices, Action{Type: "leader"})
		}
	}
	return choices
}
func (r *Room) botChoices(c Catalog) []Action { return r.candidateActions(1, c) }

func cardByUID(cards []Card, uid string) Card {
	for _, card := range cards {
		if card.UID == uid {
			return card
		}
	}
	return Card{}
}

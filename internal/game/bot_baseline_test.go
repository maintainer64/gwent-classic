package game

// Frozen pre-upgrade policy for paired strength measurements only.
func (r *Room) legacyBotChoiceScore(a Action, c Catalog, difficulty BotDifficulty) (int, bool) {
	sim := r.simulation()
	beforeOwn, beforeOpp := sim.Score(1, c), sim.Score(0, c)
	var err error
	if a.Type == "leader" {
		err = sim.activateLeader(1, a, c)
	} else {
		err = sim.play(1, a, c)
	}
	if err != nil {
		return 0, false
	}
	ownDelta, oppDelta := sim.Score(1, c)-beforeOwn, sim.Score(0, c)-beforeOpp
	score := ownDelta - oppDelta
	if a.Type == "leader" {
		score += 2
	} else {
		d := c[cardByUID(r.Players[1].Hand, a.UID).Def]
		if d.Has("spy") {
			score += 17
		}
		if d.Has("medic") {
			score += 5
		}
		if d.Has("muster") {
			score += 3
		}
		if d.Has("hero") && !r.Players[0].Passed && r.Round == 1 {
			score -= 3
		}
		if d.Has("decoy") {
			score += 3
		}
		if d.Deck == "weather" && score <= 0 {
			score -= 8
		}
	}
	if r.Bot != nil {
		if r.Bot.Style == "aggressive" {
			score += ownDelta / 2
		}
		if r.Bot.Style == "economy" && a.Type == "play" {
			score -= c[cardByUID(r.Players[1].Hand, a.UID).Def].Power() / 3
			if c[cardByUID(r.Players[1].Hand, a.UID).Def].Has("spy") {
				score += 10
			}
		}
	}
	if difficulty == BotNormal {
		score += randomInt(12) - 5
	}
	return score, true
}

func (r *Room) legacyCandidateActions(player int, c Catalog) []Action {
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
			for _, target := range r.eligibleGrave(player, c) {
				row := d.Row
				if row == "agile" {
					row = "close"
				}
				targetRows := []string{""}
				if c[target.Def].Row == "agile" {
					targetRows = []string{"close", "ranged"}
				}
				for _, targetRow := range targetRows {
					choices = append(choices, Action{Type: "play", UID: card.UID, Row: row, Target: target.UID, TargetRow: targetRow})
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
				// Bot discards its two weakest units and draws the strongest available one.
				discard := append([]Card(nil), p.Hand...)
				for i := range discard {
					for j := i + 1; j < len(discard); j++ {
						if c[discard[i].Def].Power() > c[discard[j].Def].Power() {
							discard[i], discard[j] = discard[j], discard[i]
						}
					}
				}
				draw := p.Deck[0]
				for _, card := range p.Deck {
					if c[card.Def].Power() > c[draw.Def].Power() {
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

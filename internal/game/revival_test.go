package game

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestMedicCanReviveAgileIntoEitherRow(t *testing.T) {
	for _, row := range []string{"", "close", "ranged"} {
		t.Run("row="+row, func(t *testing.T) {
			r, c := manualRoom()
			medic := appendCard(&c, "Medic", "siege", "medic", 5)
			agile := appendCard(&c, "Agile", "agile", "", 6)
			spare := appendCard(&c, "Spare", "close", "", 2)
			r.Players[0].Hand = []Card{medic, spare}
			r.Players[0].Grave = []Card{agile}
			r.Players[1].Hand = []Card{{UID: "opponent-spare", Def: spare.Def}}
			if err := r.Apply(0, Action{Type: "play", UID: medic.UID, Row: "siege", Target: agile.UID, TargetRow: row}, c); err != nil {
				t.Fatal(err)
			}
			expected := row
			if expected == "" {
				expected = "close"
			}
			got := r.Players[0].Rows[expected]
			if len(got) != 1 || got[0].UID != agile.UID {
				t.Fatalf("agile went to wrong row: %+v", r.Players[0].Rows)
			}
			if len(r.Players[0].Rows["siege"]) != 1 || len(r.Players[0].Grave) != 0 || r.Turn != 1 {
				t.Fatal("Medic did not finish its move correctly")
			}
		})
	}
}

func TestInvalidRevivalDestinationLeavesStateUnchanged(t *testing.T) {
	for _, chained := range []bool{false, true} {
		t.Run(map[bool]string{false: "initial", true: "chain"}[chained], func(t *testing.T) {
			r, c := manualRoom()
			medic := appendCard(&c, "Medic", "siege", "medic", 5)
			agile := appendCard(&c, "Agile", "agile", "", 6)
			r.Players[0].Hand = []Card{medic}
			r.Players[0].Grave = []Card{agile}
			a := Action{Type: "play", UID: medic.UID, Row: "siege", Target: agile.UID, TargetRow: "siege"}
			if chained {
				r.PendingOwner = 1
				a.Type = "revive"
			}
			before, _ := json.Marshal(r)
			if err := r.Apply(0, a, c); err == nil {
				t.Fatal("agile was allowed into siege")
			}
			after, _ := json.Marshal(r)
			if !bytes.Equal(before, after) {
				t.Fatal("rejected destination mutated state")
			}
		})
	}
}

func TestChainedMedicKeepsChoiceOfAgileDestination(t *testing.T) {
	r, c := manualRoom()
	first := appendCard(&c, "First Medic", "siege", "medic", 5)
	second := appendCard(&c, "Second Medic", "close", "medic", 5)
	agile := appendCard(&c, "Agile", "agile", "", 6)
	spare := appendCard(&c, "Spare", "close", "", 2)
	r.Players[0].Hand = []Card{first, spare}
	r.Players[0].Grave = []Card{second, agile}
	r.Players[1].Hand = []Card{{UID: "opponent-spare", Def: spare.Def}}
	if err := r.Apply(0, Action{Type: "play", UID: first.UID, Row: "siege", Target: second.UID}, c); err != nil {
		t.Fatal(err)
	}
	if r.PendingOwner != 1 || r.Turn != 0 {
		t.Fatal("chain ended before next choice")
	}
	if err := r.Apply(0, Action{Type: "revive", Target: agile.UID, TargetRow: "ranged"}, c); err != nil {
		t.Fatal(err)
	}
	if r.PendingOwner != 0 || r.Turn != 1 || len(r.Players[0].Grave) != 0 || r.Players[0].Rows["ranged"][0].UID != agile.UID {
		t.Fatal("chain lost selected destination")
	}
}

func TestInvaderResolvesWholeMedicChainWithoutManualChoice(t *testing.T) {
	r, c := manualRoom()
	first := appendCard(&c, "First Medic", "siege", "medic", 5)
	second := appendCard(&c, "Second Medic", "close", "medic", 5)
	third := appendCard(&c, "Third Medic", "ranged", "medic", 5)
	spare := appendCard(&c, "Spare", "close", "", 2)
	invader := appendCard(&c, "Invader", "leader", "emhyr_invader", 0)
	r.Players[1].Leader = invader.Def + 1
	r.Players[0].Hand = []Card{first, spare}
	r.Players[0].Grave = []Card{second, third}
	r.Players[1].Hand = []Card{{UID: "opponent-spare", Def: spare.Def}}
	if err := r.Apply(0, Action{Type: "play", UID: first.UID, Row: "siege"}, c); err != nil {
		t.Fatal(err)
	}
	if r.PendingOwner != 0 || r.Turn != 1 || len(r.Players[0].Grave) != 0 {
		t.Fatal("random chain requested a manual choice or stalled")
	}
	if len(r.Players[0].Rows["close"]) != 1 || len(r.Players[0].Rows["ranged"]) != 1 {
		t.Fatal("not all random Medics were revived")
	}
}

func TestInvaderDoesNotRandomizeLeaderReturnsToHand(t *testing.T) {
	for _, own := range []bool{false, true} {
		t.Run(map[bool]string{false: "Emhyr", true: "Eredin"}[own], func(t *testing.T) {
			r, c := manualRoom()
			ability := "emhyr_relentless"
			from := 1
			if own {
				ability = "eredin_bringer_of_death"
				from = 0
			}
			leader := appendCard(&c, "Taking leader", "leader", ability, 0)
			invader := appendCard(&c, "Invader", "leader", "emhyr_invader", 0)
			weak := appendCard(&c, "Chosen weak card", "close", "", 1)
			strong := appendCard(&c, "Other strong card", "siege", "", 10)
			hero := appendCard(&c, "Hero", "close", "hero", 15)
			r.Players[0].Leader = leader.Def + 1
			r.Players[1].Leader = invader.Def + 1
			r.Players[from].Grave = []Card{weak, strong, hero}
			before, _ := json.Marshal(r)
			for _, target := range []string{"forged", hero.UID} {
				if err := r.activateLeader(0, Action{Target: target}, c); err == nil {
					t.Fatal("Invader allowed an illegal hand-return target")
				}
				after, _ := json.Marshal(r)
				if !bytes.Equal(before, after) {
					t.Fatal("rejected target consumed leader or changed cards")
				}
			}
			if err := r.activateLeader(0, Action{Target: weak.UID}, c); err != nil {
				t.Fatal(err)
			}
			if len(r.Players[0].Hand) != 1 || r.Players[0].Hand[0].UID != weak.UID {
				t.Fatal("chosen hand-return target was randomized")
			}
			if len(r.Players[from].Grave) != 2 || !r.Players[0].LeaderUsed {
				t.Fatal("leader did not consume exactly the selected card")
			}
		})
	}
}

func TestOrdinaryRoundCleanupDoesNotEmitDestruction(t *testing.T) {
	r, c := manualRoom()
	unit := appendCard(&c, "Footman", "close", "", 5)
	r.Players[0].Rows["close"] = []Card{unit}
	r.finishRound(c)
	sawEnd, sawStart := false, false
	for _, event := range r.Transitions {
		if event.Type == "destroyed" {
			t.Fatal("ordinary cleanup looked like Scorch")
		}
		if event.Type == "round_end" {
			sawEnd = true
			if len(event.Frame.Players[0].Rows["close"]) != 1 {
				t.Fatal("round result lost board")
			}
		}
		if event.Type == "round_start" {
			sawStart = true
			if len(event.Frame.Players[0].Rows["close"]) != 0 {
				t.Fatal("new round retained ordinary unit")
			}
		}
	}
	if !sawEnd || !sawStart {
		t.Fatal("round transition frames missing")
	}
}

// Every advertised leader must either execute its supported active command or
// reject activation as passive, rather than silently falling through the API.
func TestEveryCatalogLeaderHasExecutableContract(t *testing.T) {
	c := realCatalog(t)
	options := LeaderOptions(c)
	if len(options) != 22 {
		t.Fatalf("leader coverage changed: %d", len(options))
	}
	for _, option := range options {
		t.Run(option.Ability, func(t *testing.T) {
			r, _ := manualRoom()
			r.Players[0].Faction = option.Faction
			r.Players[0].Leader = option.ID
			unit := c.Find("Vesemir")
			frost := c.Find("Biting Frost")
			fog := c.Find("Impenetrable Fog")
			rain := c.Find("Torrential Rain")
			r.Players[0].Hand = []Card{{UID: "discard-a", Def: unit}, {UID: "discard-b", Def: unit}, {UID: "spare", Def: unit}}
			r.Players[0].Deck = []Card{{UID: "fog", Def: fog}, {UID: "rain", Def: rain}, {UID: "frost", Def: frost}, {UID: "draw-choice", Def: unit}}
			r.Players[0].Grave = []Card{{UID: "own-grave", Def: unit}}
			r.Players[1].Grave = []Card{{UID: "other-grave", Def: unit}}
			r.Players[1].Hand = []Card{{UID: "hidden-a", Def: unit}, {UID: "hidden-b", Def: unit}, {UID: "hidden-c", Def: unit}, {UID: "hidden-d", Def: unit}}
			action := Action{Type: "leader"}
			switch option.Ability {
			case "emhyr_relentless":
				action.Target = "other-grave"
			case "eredin_bringer_of_death":
				action.Target = "own-grave"
			case "eredin_king":
				action.Target = "frost"
			case "eredin_destroyer":
				action.Targets = []string{"discard-a", "discard-b"}
				action.Draw = "draw-choice"
			}
			before, _ := json.Marshal(r)
			err := r.activateLeader(0, action, c)
			if option.Passive {
				if err == nil {
					t.Fatal("passive leader executed an active turn")
				}
				after, _ := json.Marshal(r)
				if !bytes.Equal(before, after) {
					t.Fatal("passive activation mutated the match")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !r.Players[0].LeaderUsed {
				t.Fatal("active leader was not consumed")
			}
			used, _ := json.Marshal(r)
			if err := r.activateLeader(0, action, c); err == nil {
				t.Fatal("leader executed twice")
			}
			after, _ := json.Marshal(r)
			if !bytes.Equal(used, after) {
				t.Fatal("second activation changed cards")
			}
			if option.Ability == "emhyr_emperor" {
				if len(r.Project(0, c).Players[0].Peek) != 3 {
					t.Fatal("Emhyr did not reveal three cards")
				}
				if len(r.Project(1, c).Players[0].Peek) != 0 {
					t.Fatal("private reconnaissance leaked")
				}
			}
		})
	}
}

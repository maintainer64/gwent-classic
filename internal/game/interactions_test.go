package game

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestDimunPirateScorchesOtherUnitsButNeverItself(t *testing.T) {
	for _, revived := range []bool{false, true} {
		t.Run(map[bool]string{false: "played", true: "revived"}[revived], func(t *testing.T) {
			c := realCatalog(t)
			r, _ := manualRoom()
			pirate := Card{UID: "pirate", Def: c.Find("Clan Dimun Pirate")}
			victim := Card{UID: "victim", Def: c.Find("Emiel Regis Rohellec Terzieff")}
			hero := Card{UID: "immune-hero", Def: c.Find("Geralt of Rivia")}
			r.Players[1].Rows["close"] = []Card{victim, hero}
			if revived {
				r.Players[0].Grave = []Card{pirate}
				r.reviveTarget(0, pirate.UID, c)
			} else {
				r.Players[0].Hand = []Card{pirate}
				if err := r.play(0, Action{UID: pirate.UID, Row: "ranged"}, c); err != nil {
					t.Fatal(err)
				}
			}
			if len(r.Players[0].Rows["ranged"]) != 1 || r.Players[0].Rows["ranged"][0].UID != pirate.UID {
				t.Fatal("Pirate destroyed itself")
			}
			if len(r.Players[1].Rows["close"]) != 1 || r.Players[1].Rows["close"][0].UID != hero.UID {
				t.Fatal("unit Scorch failed or hit a hero")
			}
			if len(r.Players[1].Grave) != 1 || r.Players[1].Grave[0].UID != victim.UID {
				t.Fatal("wrong Scorch graveyard")
			}
		})
	}
}

func TestDimunPirateUsesModifiedPowerAndDestroysTiesOnBothSides(t *testing.T) {
	c := realCatalog(t)
	r, _ := manualRoom()
	pirate := Card{UID: "pirate", Def: c.Find("Clan Dimun Pirate")}
	victim := c.Find("Vesemir")
	r.Players[0].Hand = []Card{pirate}
	r.Players[0].Rows["close"] = []Card{{UID: "own-victim", Def: victim}}
	r.Players[1].Rows["close"] = []Card{{UID: "other-victim", Def: victim}}
	r.Weather = []string{"fog"}
	if err := r.play(0, Action{UID: pirate.UID, Row: "ranged"}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Rows["close"]) != 0 || len(r.Players[1].Rows["close"]) != 0 {
		t.Fatal("global unit Scorch must destroy both tied maxima")
	}
	if len(r.Players[0].Rows["ranged"]) != 1 || r.Score(0, c) != 1 {
		t.Fatal("Pirate's weather-adjusted strength changed")
	}
}

func TestCerysSummonsShieldMaidensFromBothPilesWithBond(t *testing.T) {
	c := realCatalog(t)
	r, _ := manualRoom()
	cerys := Card{UID: "cerys", Def: c.Find("Cerys")}
	var maidens []Card
	for i, d := range c {
		if strings.HasPrefix(d.Name, "Cerys - ") {
			maidens = append(maidens, Card{UID: d.StableKey(), Def: i})
		}
	}
	if len(maidens) != 3 {
		t.Fatal("catalogue must have three shield maidens")
	}
	r.Players[0].Hand = []Card{cerys, maidens[0]}
	r.Players[0].Deck = []Card{maidens[1], maidens[2]}
	if err := r.play(0, Action{UID: cerys.UID, Row: "close"}, c); err != nil {
		t.Fatal(err)
	}
	if len(r.Players[0].Hand) != 0 || len(r.Players[0].Deck) != 0 || len(r.Players[0].Rows["close"]) != 4 {
		t.Fatal("Cerys did not summon the entire group")
	}
	if r.Score(0, c) != 46 {
		t.Fatalf("Cerys + three bonded Maidens: got %d, want 46", r.Score(0, c))
	}
}

func TestTransformedBerserkersKeepBondAfterDecoyAndReplay(t *testing.T) {
	c := realCatalog(t)
	r, _ := manualRoom()
	ermion := Card{UID: "ermion", Def: c.Find("Ermion")}
	berserker := c.Find("Young Berserker")
	decoy := Card{UID: "decoy", Def: c.Find("Decoy")}
	r.Players[0].Rows["ranged"] = []Card{{UID: "bear-a", Def: berserker}, {UID: "bear-b", Def: berserker}}
	r.Players[0].Hand = []Card{ermion, decoy}
	if err := r.play(0, Action{UID: ermion.UID, Row: "ranged"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Score(0, c) != 40 {
		t.Fatalf("transformed bond + Ermion: got %d", r.Score(0, c))
	}
	bear := r.Players[0].Rows["ranged"][0]
	if c[bear.Def].Name != "Transformed Young Vildkaarl" {
		t.Fatal("wrong transformation")
	}
	if err := r.play(0, Action{UID: decoy.UID, Target: bear.UID}, c); err != nil {
		t.Fatal(err)
	}
	if r.Score(0, c) != 16 {
		t.Fatal("Decoy did not break transformed bond")
	}
	if len(r.Players[0].Hand) != 1 || r.Players[0].Hand[0].Def != bear.Def {
		t.Fatal("Decoy reverted the transformed card")
	}
	if err := r.play(0, Action{UID: bear.UID, Row: "ranged"}, c); err != nil {
		t.Fatal(err)
	}
	if r.Score(0, c) != 40 {
		t.Fatal("replayed Vildkaarl did not restore bond")
	}
}

func TestLeaderHornAlsoBlocksSubsequentMardroeme(t *testing.T) {
	c := realCatalog(t)
	for _, ability := range []string{"foltest_siegemaster", "eredin_commander", "francesca_beautiful"} {
		t.Run(ability, func(t *testing.T) {
			r, _ := manualRoom()
			for _, leader := range LeaderOptions(c) {
				if leader.Ability == ability {
					r.Players[0].Leader = leader.ID
				}
			}
			row := map[string]string{"foltest_siegemaster": "siege", "eredin_commander": "close", "francesca_beautiful": "ranged"}[ability]
			if err := r.activateLeader(0, Action{}, c); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"Mardroeme", "Commander's Horn"} {
				card := Card{UID: "special", Def: c.Find(name)}
				r.Players[0].Hand = []Card{card}
				before, _ := json.Marshal(r)
				if err := r.play(0, Action{UID: card.UID, Row: row}, c); err == nil {
					t.Fatal("special overwrote the leader's Horn slot")
				}
				after, _ := json.Marshal(r)
				if !bytes.Equal(before, after) {
					t.Fatal("rejected special consumed cards or modified effects")
				}
			}
		})
	}
}

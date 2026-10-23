package game

import (
	"math"
	"testing"
	"time"
)

func TestConfiguredTimerModesAndDuration(t *testing.T) {
	for _, mode := range []TimerMode{TimerHard, TimerSoft} {
		t.Run(string(mode), func(t *testing.T) {
			r, c := clockRoom()
			r.Timer = &TurnTimer{Minutes: 2.5, Mode: mode}
			r.BeginTurn(r.CreatedAt)
			due := r.CreatedAt.Add(150 * time.Second)
			if !r.TurnDeadline.Equal(due) {
				t.Fatal("custom minutes ignored")
			}
			if r.Tick(due.Add(-time.Nanosecond), c) {
				t.Fatal("timer fired early")
			}
			changed := r.Tick(due, c)
			if mode == TimerSoft {
				if changed || r.Players[0].Passed || r.Turn != 0 || !r.TurnDeadline.Equal(due) {
					t.Fatal("soft timer must only warn")
				}
				if err := r.Apply(0, Action{Type: "play", UID: "human-hand", Row: "close"}, c); err != nil {
					t.Fatalf("soft timer blocked late move: %v", err)
				}
			} else if !changed || !r.Players[0].Passed || r.Turn != 1 {
				t.Fatal("hard timer must force pass")
			}
		})
	}
}
func TestDisabledAndVeryLongTimers(t *testing.T) {
	r, c := clockRoom()
	r.Timer = &TurnTimer{Minutes: 0, Mode: TimerHard}
	if r.BeginTurn(r.CreatedAt) || !r.TurnDeadline.IsZero() || r.Tick(r.CreatedAt.Add(time.Hour), c) {
		t.Fatal("zero must disable turn timer")
	}
	r.Timer.Minutes = math.MaxFloat64
	r.BeginTurn(r.CreatedAt)
	if !r.TurnDeadline.Equal(r.ExpiresAt) {
		t.Fatal("long timers must be bounded by room lifetime without overflow")
	}
}
func TestTimerValidation(t *testing.T) {
	for _, timer := range []TurnTimer{{Minutes: -1}, {Minutes: math.NaN()}, {Minutes: math.Inf(1)}, {Minutes: 1, Mode: "invalid"}} {
		if _, err := NormalizeTimer(&timer); err == nil {
			t.Fatalf("invalid timer accepted: %+v", timer)
		}
	}
}

func clockRoom() (*Room, Catalog) {
	r, c := manualRoom()
	r.Phase = "turn"
	r.CreatedAt = time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	r.ExpiresAt = r.CreatedAt.Add(RoomLifetime)
	r.Players[0].Hand = []Card{{UID: "human-hand", Def: c.Find("realms soldier 0")}}
	r.Players[1].Hand = []Card{{UID: "op-hand", Def: c.Find("realms soldier 1")}}
	return r, c
}
func TestHardDeadlinePersistsAndForcesPass(t *testing.T) {
	r, c := clockRoom()
	now := r.CreatedAt
	if !r.BeginTurn(now) {
		t.Fatal("deadline not initialized")
	}
	due := r.TurnDeadline
	if !due.Equal(now.Add(60 * time.Second)) {
		t.Fatalf("unexpected due: %s", due)
	}
	if r.Tick(now.Add(59*time.Second), c) {
		t.Fatal("early timeout")
	}
	if r.TurnDeadline != due {
		t.Fatal("polling changed deadline")
	}
	if !r.Tick(due, c) || !r.Players[0].Passed || r.Turn != 1 {
		t.Fatal("deadline did not force pass")
	}
	if r.Version != 1 || !r.TurnDeadline.Equal(due.Add(60*time.Second)) {
		t.Fatal("next turn deadline not rearmed")
	}
}
func TestTimerNotActiveInMulliganOrInitiative(t *testing.T) {
	r, c := clockRoom()
	r.Phase = "mulligan"
	r.BeginTurn(r.CreatedAt)
	if !r.TurnDeadline.IsZero() || r.Tick(r.CreatedAt.Add(time.Hour), c) {
		t.Fatal("mulligan must not auto-pass")
	}
	r.Phase = "turn"
	r.Initiative = 1
	r.BeginTurn(r.CreatedAt)
	if !r.TurnDeadline.IsZero() || r.Tick(r.CreatedAt.Add(time.Hour), c) {
		t.Fatal("initiative must not auto-pass")
	}
}
func TestTimedOutMedicChainIsCompletedOnServer(t *testing.T) {
	r, c := clockRoom()
	// The timeout policy picks the strongest card; make it a Medic so the
	// scenario genuinely exercises a second automatic revival.
	medic := appendCard(&c, "Revived medic", "close", "medic", 8)
	rescued := appendCard(&c, "Rescued soldier", "siege", "", 7)
	r.Players[0].Grave = []Card{medic, rescued}
	r.PendingOwner = 1
	r.BeginTurn(r.CreatedAt)
	if !r.Tick(r.TurnDeadline, c) {
		t.Fatal("must process timeout")
	}
	if r.PendingOwner != 0 || !r.Players[0].Passed || len(r.Players[0].Grave) != 0 {
		t.Fatalf("medic chain not safely resolved: %+v", r)
	}
}
func TestTimedOutRoomCapsDeadlineToRoomLifetime(t *testing.T) {
	r, _ := clockRoom()
	now := r.ExpiresAt.Add(-20 * time.Second)
	r.BeginTurn(now)
	if !r.TurnDeadline.Equal(r.ExpiresAt) {
		t.Fatal("deadline cannot exceed 24h room expiry")
	}
}

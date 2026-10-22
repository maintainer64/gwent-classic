package game

import (
	"errors"
	"math"
	"time"
)

type TimerMode string

const (
	TimerHard TimerMode = "hard"
	TimerSoft TimerMode = "soft"
)

// A nil timer preserves the original one-minute hard limit for saved rooms and
// old clients. Explicit zero minutes disables the turn clock.
type TurnTimer struct {
	Minutes float64   `json:"minutes"`
	Mode    TimerMode `json:"mode"`
}

func NormalizeTimer(timer *TurnTimer) (TurnTimer, error) {
	if timer == nil {
		return TurnTimer{Minutes: 1, Mode: TimerHard}, nil
	}
	result := *timer
	if result.Mode == "" {
		result.Mode = TimerHard
	}
	if math.IsNaN(result.Minutes) || math.IsInf(result.Minutes, 0) || result.Minutes < 0 || (result.Mode != TimerHard && result.Mode != TimerSoft) {
		return TurnTimer{}, errors.New("invalid timer settings")
	}
	return result, nil
}
func (r *Room) TimerSettings() TurnTimer {
	timer, _ := NormalizeTimer(r.Timer)
	return timer
}
func (r *Room) turnDuration() time.Duration {
	// Room expiry is the upper bound. Clamp before converting to nanoseconds so
	// arbitrary user-entered minutes cannot overflow time.Duration.
	return time.Duration(math.Min(r.TimerSettings().Minutes, RoomLifetime.Minutes()) * float64(time.Minute))
}

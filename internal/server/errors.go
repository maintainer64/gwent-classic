package server

import "strings"

// Machine-readable codes are localized by the client. The original error field
// remains available to older API clients and diagnostics.
func errorCode(status int, message string) string {
	switch status {
	case 403:
		return "forbidden"
	case 404:
		return "not_found"
	case 410:
		return "expired"
	case 429:
		return "rate_limit"
	case 500, 503:
		return "server_error"
	}
	if strings.Contains(message, "Name must") {
		return "invalid_name"
	}
	if strings.Contains(message, "not accepting") || strings.Contains(message, "already joined") {
		return "room_full"
	}
	if strings.Contains(message, "deck") || strings.Contains(message, "card count") || strings.Contains(message, "card definition") || strings.Contains(message, "card key") || strings.Contains(message, "outside selected faction") {
		return "invalid_deck"
	}
	if strings.Contains(message, "timer") {
		return "invalid_timer"
	}
	if strings.Contains(message, "bot") || strings.Contains(message, "faction") || strings.Contains(message, "unsupported leader for") || strings.Contains(message, "invalid mode") {
		return "invalid_setup"
	}
	if status == 409 {
		return "conflict"
	}
	return "invalid_move"
}

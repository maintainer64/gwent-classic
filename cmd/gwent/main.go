package main

import (
	"log"
	"os"
	"time"

	"github.com/maintainer64/gwent-classic/internal/game"
	"github.com/maintainer64/gwent-classic/internal/server"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func main() {
	cards, err := game.DefaultCatalog()
	if file := os.Getenv("CARDS_FILE"); file != "" {
		cards, err = server.ReadCards(file)
	}
	if err != nil {
		log.Fatal(err)
	}
	if err := cards.Valid(); err != nil {
		log.Fatal(err)
	}
	store, err := server.NewStore(env("DATA_DIR", "./data"))
	if err != nil {
		log.Fatal(err)
	}
	store.Clean()
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for range t.C {
			store.Clean()
		}
	}()
	api := server.NewAPI(store, cards, env("STATIC_DIR", "web/dist"))
	api.SecureCookie = os.Getenv("COOKIE_SECURE") == "true"
	api.PublicOrigin = os.Getenv("PUBLIC_ORIGIN")
	log.Printf("Card definitions loaded: %d", len(cards))
	log.Fatal(api.Serve(env("LISTEN_ADDR", ":8080")))
}

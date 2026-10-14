// Package notifier provides alerting integrations for system events (e.g. Telegram notifications).
package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// Notifier handles sending alerts to external channels.
type Notifier struct {
	botToken string
	chatID   string
	client   *http.Client
}

// New creates a new Notifier. If botToken or chatID is empty, notifications are silently skipped.
func New(botToken, chatID string) *Notifier {
	return &Notifier{
		botToken: botToken,
		chatID:   chatID,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// NotifyBuildFailure sends an alert message to Telegram asynchronously when a filter compilation fails.
func (n *Notifier) NotifyBuildFailure(filterURL string, errMessage string) {
	if n.botToken == "" || n.chatID == "" {
		return
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Notifier] Recovered from panic in NotifyBuildFailure: %v", r)
			}
		}()

		text := fmt.Sprintf(
			"🚨 *[BlockAds Compiler] Build Failed (Error 500)*\n\n"+
				"• *URL:* `%s`\n"+
				"• *Error:* `%s`\n"+
				"• *Time:* `%s`",
			filterURL,
			errMessage,
			time.Now().UTC().Format("2006-01-02 15:04:05 UTC"),
		)

		payload := map[string]string{
			"chat_id":    n.chatID,
			"text":       text,
			"parse_mode": "Markdown",
		}

		body, err := json.Marshal(payload)
		if err != nil {
			log.Printf("[Notifier] Failed to marshal Telegram payload: %v", err)
			return
		}

		url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", n.botToken)
		resp, err := n.client.Post(url, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("[Notifier] Failed to send Telegram alert: %v", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("[Notifier] Telegram API returned non-200 status: %d", resp.StatusCode)
		} else {
			log.Printf("[Notifier] ✓ Telegram alert sent for failed build: %s", filterURL)
		}
	}()
}

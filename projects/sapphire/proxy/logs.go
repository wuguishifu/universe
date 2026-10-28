package sapphireproxy

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

const maxLogLines = 500

var (
	logMu    sync.Mutex
	logLines []string
)

func logf(format string, args ...any) {
	line := time.Now().Format("15:04:05.000 ") + fmt.Sprintf(format, args...)
	log.Print(line)

	logMu.Lock()
	defer logMu.Unlock()
	logLines = append(logLines, line)
	if len(logLines) > maxLogLines {
		logLines = logLines[len(logLines)-maxLogLines:]
	}
}

// Log adds a line from the host app (the vault, the JS side) to the same buffer, so one log shows
// the tailnet coming up and the requests waiting on it.
func Log(line string) {
	logf("%s", line)
}

// RecentLogs returns the most recent tsnet/proxy log lines, newest last.
func RecentLogs() string {
	logMu.Lock()
	defer logMu.Unlock()
	return strings.Join(logLines, "\n")
}

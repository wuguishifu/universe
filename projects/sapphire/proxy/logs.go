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

// RecentLogs returns the most recent tsnet/proxy log lines, newest last.
func RecentLogs() string {
	logMu.Lock()
	defer logMu.Unlock()
	return strings.Join(logLines, "\n")
}

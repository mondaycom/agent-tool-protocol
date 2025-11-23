#!/bin/bash
# Script to show GraphQL queries in real-time from server logs

LOG_FILE="${1:-/tmp/monday-debug-mode.log}"

if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    echo "Usage: $0 [log-file-path]"
    echo "Default: $0 /tmp/monday-debug-mode.log"
    exit 1
fi

echo "📊 Watching GraphQL queries from: $LOG_FILE"
echo "Press Ctrl+C to stop"
echo ""

# Follow the log file and highlight GraphQL queries
tail -f "$LOG_FILE" | grep --line-buffered -A 15 "GraphQL.*Query:" | while read line; do
    if [[ "$line" =~ "GraphQL" ]]; then
        echo -e "\n\033[1;34m$line\033[0m"  # Blue bold
    elif [[ "$line" =~ "Variables:" ]]; then
        echo -e "\033[1;33m$line\033[0m"  # Yellow bold
    elif [[ "$line" =~ "=====" ]]; then
        echo -e "\033[0;36m$line\033[0m"  # Cyan
    else
        echo "$line"
    fi
done



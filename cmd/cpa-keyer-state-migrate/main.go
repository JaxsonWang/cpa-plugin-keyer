package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/JaxsonWang/cpa-plugin-keyer/internal/policy"
)

func main() {
	source := flag.String("source", "", "legacy JSON state file")
	destination := flag.String("destination", "", "new SQLite state file")
	flag.Parse()

	summary, err := policy.MigrateLegacyStateFile(*source, *destination)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	output, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(output))
}

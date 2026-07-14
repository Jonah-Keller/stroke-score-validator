#!/bin/bash
# Double-click this on a Mac to run the validation.
cd "$(dirname "$0")"
Rscript run.R
echo ""
echo "Done. Open validation_output/validation_report.html in your browser."
read -n 1 -s -r -p "Press any key to close..."

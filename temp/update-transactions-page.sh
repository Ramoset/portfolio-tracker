#!/bin/bash
cd "/Users/lucaproff/Library/Mobile Documents/com~apple~CloudDocs/CLAUDE AI/Progetto Website Wallet/portfolio-tracker-boilerplate"

# Backup
cp "app/(dashboard)/transactions/page.tsx" "app/(dashboard)/transactions/page.tsx.backup.$(date +%s)" 2>/dev/null

# Download from outputs
curl -o "app/(dashboard)/transactions/page.tsx" "file:///mnt/user-data/outputs/transactions-page-FINAL.tsx"

echo "✅ File updated! Now run: npm run dev"

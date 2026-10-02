#!/usr/bin/env bash
# Fire N requests at a Shopware runtime and summarise the X-Probe-* headers
# emitted by the FrankenPhpProbe plugin.
#
#   probe.sh <base-url> <requests> [path ...]
#   probe.sh http://localhost:8106 300 / '/search?search={rand}' /api/_info/version
#
# {rand} in a path is replaced by a unique value per request (distinct strings
# make per-request caches such as Twig's escape cache grow if never reset).
#
# Paths are requested round-robin. Measure uncached responses only (run the
# FrankenPHP container with FRANKENPHP_HTTP_CACHE=0 for storefront pages).
set -euo pipefail

base=${1:?base url}
n=${2:-100}
shift 2 || true
paths=("${@:-/}")

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

for ((i = 0; i < n; i++)); do
    t=${paths[$((i % ${#paths[@]}))]}
    p=${t//\{rand\}/$RANDOM$i}
    curl -s -o /dev/null -D - "$base$p" | tr -d '\r' | awk -v p="$t" '
        BEGIN { IGNORECASE = 1 }
        /^HTTP\// { code = $2 }
        tolower($1) ~ /^x-probe-/ { k = tolower(substr($1, 9)); sub(/:$/, "", k); v[k] = $2 }
        END {
            printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", code, p, v["pid"], v["process-requests"],
                v["service-resets"], v["leaked-path"], v["memory"], v["escape-cache"]
        }' >>"$tmp"
done

awk -F'\t' -v base="$base" '
    {
        codes[$1]++
        if ($6 != "-" && $6 != "") leaked++
        if ($4 + 0 > maxreq) maxreq = $4 + 0
        if ($5 + 0 > maxreset) maxreset = $5 + 0
        if (!($2 in first)) { first[$2] = $7; order[++np] = $2 }
        last[$2] = $7
        if ($7 + 0 > max[$2]) max[$2] = $7 + 0
        if ($8 + 0 > maxesc) maxesc = $8 + 0
        esc = $8
    }
    END {
        printf "target             %s (%d requests)\n", base, NR
        printf "status codes       "; for (c in codes) printf "%s=%d ", c, codes[c]; printf "\n"
        printf "max requests/proc  %d\n", maxreq
        printf "max service resets %d\n", maxreset
        printf "leaked state       %d responses saw the previous request path\n", leaked
        printf "escape cache       last %d entries (max %d)\n", esc, maxesc
        for (i = 1; i <= np; i++)
            printf "memory %-24s first %.1f MB  last %.1f MB  max %.1f MB\n", order[i], first[order[i]] / 1048576, last[order[i]] / 1048576, max[order[i]] / 1048576
    }' "$tmp"

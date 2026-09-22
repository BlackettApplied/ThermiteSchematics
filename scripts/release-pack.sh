#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[[ $# -eq 4 && $1 == "--output" && $2 == "release-out" && $3 == "--source-commit" ]] ||
  fail "REL010 Usage: scripts/release-pack.sh --output release-out --source-commit <lowercase-40-hex>."
output=$2
source_commit=$4
[[ $source_commit =~ ^[0-9a-f]{40}$ ]] || fail "REL011 Source commit must be lowercase 40-hex."

declare -A supplied=(
  [HOME]="release-out/.home"
  [LANG]="C"
  [LC_ALL]="C"
  [NPM_CONFIG_AUDIT]="false"
  [NPM_CONFIG_CACHE]="release-out/.npm-cache"
  [NPM_CONFIG_FUND]="false"
  [NPM_CONFIG_GLOBALCONFIG]="release-out/.npm-globalrc"
  [NPM_CONFIG_IGNORE_SCRIPTS]="true"
  [NPM_CONFIG_UPDATE_NOTIFIER]="false"
  [NPM_CONFIG_USERCONFIG]="release-out/.npm-userrc"
  [PATH]="/opt/hostedtoolcache/node/24.11.1/x64/bin:/usr/bin:/bin"
  [SOURCE_DATE_EPOCH]="0"
  [TZ]="UTC"
)

declare -A observed=()
while IFS= read -r -d '' pair; do observed["${pair%%=*}"]=${pair#*=}; done < <(env -0)
for generated in PWD SHLVL _; do
  [[ -v observed[$generated] ]] || fail "REL012 Bash-generated environment key '$generated' is missing."
  unset 'observed[$generated]'
done
[[ ${#observed[@]} -eq ${#supplied[@]} ]] || fail "REL013 Launcher environment contains an extra or missing key."
for key in "${!supplied[@]}"; do
  [[ -v observed[$key] && ${observed[$key]} == "${supplied[$key]}" ]] ||
    fail "REL014 Launcher environment value differs for '$key'."
done

if [[ -e $output ]]; then
  [[ -d $output && ! -L $output ]] || fail "REL015 release-out is not an ordinary directory."
else
  mkdir -- "$output"
fi
for path in "$output/.home" "$output/.npm-cache"; do
  [[ ! -e $path ]] || fail "REL016 Release isolation path already exists: $path."
  mkdir -- "$path"
done
for path in "$output/.npm-userrc" "$output/.npm-globalrc"; do
  [[ ! -e $path ]] || fail "REL016 Release isolation path already exists: $path."
  (set -o noclobber; : > "$path")
done

clean_env=(
  /usr/bin/env -i
  HOME=release-out/.home
  LANG=C
  LC_ALL=C
  NPM_CONFIG_AUDIT=false
  NPM_CONFIG_CACHE=release-out/.npm-cache
  NPM_CONFIG_FUND=false
  NPM_CONFIG_GLOBALCONFIG=release-out/.npm-globalrc
  NPM_CONFIG_IGNORE_SCRIPTS=true
  NPM_CONFIG_UPDATE_NOTIFIER=false
  NPM_CONFIG_USERCONFIG=release-out/.npm-userrc
  PATH=/opt/hostedtoolcache/node/24.11.1/x64/bin:/usr/bin:/bin
  SOURCE_DATE_EPOCH=0
  TZ=UTC
)

[[ $("${clean_env[@]}" node --version) == "v24.11.1" ]] || fail "REL017 Node version mismatch."
[[ $("${clean_env[@]}" npm --version) == "11.6.2" ]] || fail "REL018 npm version mismatch."
"${clean_env[@]}" npm ci --ignore-scripts --no-audit --no-fund --package-lock=true --userconfig release-out/.npm-userrc --globalconfig release-out/.npm-globalrc --cache release-out/.npm-cache
"${clean_env[@]}" npm run build
"${clean_env[@]}" node scripts/release-package.mjs --output release-out --source-commit "$source_commit"

rm -rf -- "$output/.home" "$output/.npm-cache"
rm -f -- "$output/.npm-userrc" "$output/.npm-globalrc"

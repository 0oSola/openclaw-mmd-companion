#!/bin/zsh
# Creates the restricted macOS account used exclusively by Desktop Pet.
# Run locally on macCodex as: sudo zsh /Users/sola/install-sola-codex-macos.sh <public-key-file>

set -euo pipefail

readonly ACCOUNT="sola-codex"
readonly ACCOUNT_GROUP="sola-codex"
readonly ACCOUNT_HOME="/Users/${ACCOUNT}"
readonly WORKSPACE_ROOT="/Users/sola/workspace"
readonly KSCC_ROOT="/Users/sola/Desktop/kscc"
readonly CODEX_SOURCE="/Users/sola/.codex/packages/standalone/current/bin/codex"
readonly ACL_DIRECTORY_RW="user:${ACCOUNT} allow list,search,add_file,add_subdirectory,delete_child,readattr,writeattr,readextattr,writeextattr,read,write,append,execute,directory_inherit"
readonly ACL_FILE_RW="user:${ACCOUNT} allow readattr,writeattr,readextattr,writeextattr,read,write,append,file_inherit"
readonly ACL_SEARCH="user:${ACCOUNT} allow search"
readonly ACL_DENY_PRIVATE="user:${ACCOUNT} deny list,search,read,readattr,readextattr,execute"

fail() {
  print -u2 -- "sola-codex setup: $*"
  exit 1
}

require_root() {
  [[ "$(id -u)" == "0" ]] || fail "run this script with sudo"
}

validate_public_key() {
  local key_file="$1"
  [[ -f "$key_file" ]] || fail "public key file does not exist: $key_file"
  local key
  key="$(tr -d '\r\n' < "$key_file")"
  [[ "$key" == ssh-ed25519\ * ]] || fail "only an ssh-ed25519 public key is accepted"
  [[ "$key" != *$'\n'* && "$key" != *$'\r'* ]] || fail "public key must contain exactly one line"
  print -r -- "$key"
}

next_uid() {
  dscl . -list /Users UniqueID | awk '$2 >= 501 && $2 < 1000 { if ($2 > max) max = $2 } END { print (max ? max + 1 : 502) }'
}

next_gid() {
  dscl . -list /Groups PrimaryGroupID | awk '$2 >= 501 && $2 < 1000 { if ($2 > max) max = $2 } END { print (max ? max + 1 : 502) }'
}

random_account_password() {
  /usr/bin/openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | cut -c1-28
}

ensure_group() {
  if dscl . -read "/Groups/${ACCOUNT_GROUP}" >/dev/null 2>&1; then
    return
  fi
  local gid
  gid="$(next_gid)"
  dscl . -create "/Groups/${ACCOUNT_GROUP}"
  dscl . -create "/Groups/${ACCOUNT_GROUP}" PrimaryGroupID "$gid"
  print -- "Created private group $ACCOUNT_GROUP (gid=$gid)"
}

ensure_account() {
  # A plain dscl record has no AuthenticationAuthority and macOS sshd rejects it
  # after accepting its public key. Recreate only that incomplete restricted account
  # through sysadminctl, which creates the required local-account authentication data.
  if id "$ACCOUNT" >/dev/null 2>&1 && dscl . -read "/Users/${ACCOUNT}" AuthenticationAuthority 2>/dev/null | grep -q '^AuthenticationAuthority:'; then
    print -- "Account already exists and has macOS authentication data: $ACCOUNT"
    return
  fi
  if id "$ACCOUNT" >/dev/null 2>&1; then
    print -- "Replacing incomplete restricted account record: $ACCOUNT"
    dscl . -delete "/Users/${ACCOUNT}"
  fi

  local uid gid password
  uid="$(next_uid)"
  gid="$(dscl . -read "/Groups/${ACCOUNT_GROUP}" PrimaryGroupID | awk '{print $2}')"
  password="$(random_account_password)"
  sysadminctl -addUser "$ACCOUNT" -fullName "Desktop Pet restricted Codex" -password "$password" -UID "$uid" -GID "$gid" -shell /bin/zsh -home "$ACCOUNT_HOME" >/dev/null
  dscl . -create "/Users/${ACCOUNT}" IsHidden 1
  createhomedir -c -u "$ACCOUNT" >/dev/null 2>&1 || true
  chown -R "$ACCOUNT":"$ACCOUNT_GROUP" "$ACCOUNT_HOME"
  print -- "Created account $ACCOUNT (uid=$uid)"
}

install_authorized_key() {
  local public_key="$1"
  install -d -m 700 -o "$ACCOUNT" -g "$ACCOUNT_GROUP" "$ACCOUNT_HOME/.ssh"
  local authorized_keys="$ACCOUNT_HOME/.ssh/authorized_keys"
  touch "$authorized_keys"
  chown "$ACCOUNT":"$ACCOUNT_GROUP" "$authorized_keys"
  chmod 600 "$authorized_keys"
  # Do not use OpenSSH's `restrict`: it implies no-pty, while Codex TUI needs a PTY.
  local restricted_key="no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc ${public_key}"
  if ! grep -Fqx -- "$restricted_key" "$authorized_keys"; then
    print -r -- "$restricted_key" >> "$authorized_keys"
  fi
}

allow_ssh_login() {
  # macOS Remote Login can use this service ACL in addition to sshd_config.
  # It grants SSH login only; it grants neither sudo nor file access.
  /usr/sbin/dseditgroup -o edit -a "$ACCOUNT" -t user com.apple.access_ssh
}

install_private_codex_cli() {
  [[ -f "$CODEX_SOURCE" && -x "$CODEX_SOURCE" ]] || fail "source Codex CLI is not executable: $CODEX_SOURCE"
  install -d -m 755 -o "$ACCOUNT" -g "$ACCOUNT_GROUP" "$ACCOUNT_HOME/.local/bin"
  install -m 755 -o "$ACCOUNT" -g "$ACCOUNT_GROUP" "$CODEX_SOURCE" "$ACCOUNT_HOME/.local/bin/codex"
}

grant_project_access() {
  [[ -d "$WORKSPACE_ROOT" ]] || fail "missing project root: $WORKSPACE_ROOT"
  [[ -d "$KSCC_ROOT" ]] || fail "missing project root: $KSCC_ROOT"

  # Parent folders are searchable only: the restricted account cannot enumerate them.
  chmod +a "$ACL_SEARCH" /Users/sola
  chmod +a "$ACL_SEARCH" /Users/sola/Desktop

  # `.codex` can be world-readable on a developer account. Explicitly deny the
  # restricted account so it cannot inspect the primary account's credentials,
  # sessions, skills, or configuration.
  if [[ -e /Users/sola/.codex ]]; then
    chmod +a "$ACL_DENY_PRIVATE" /Users/sola/.codex
  fi

  # Apply ACLs to directories and regular files separately. In particular, do
  # not dereference symlinks: a repository may intentionally contain stale links
  # or links outside the two allowed roots.
  local root
  for root in "$WORKSPACE_ROOT" "$KSCC_ROOT"; do
    find "$root" -xdev -type d -exec chmod +a "$ACL_DIRECTORY_RW" {} +
    find "$root" -xdev -type d -exec chmod +a "$ACL_FILE_RW" {} +
    find "$root" -xdev -type f -exec chmod +a "$ACL_FILE_RW" {} +
  done
}

verify_access() {
  su - "$ACCOUNT" -c "test -r '$WORKSPACE_ROOT' && test -r '$KSCC_ROOT'"
  if su - "$ACCOUNT" -c "ls /Users/sola/.ssh >/dev/null 2>&1"; then
    fail "restricted account can enumerate /Users/sola/.ssh"
  fi
  if su - "$ACCOUNT" -c "ls /Users/sola/Documents >/dev/null 2>&1"; then
    fail "restricted account can enumerate /Users/sola/Documents"
  fi
  if su - "$ACCOUNT" -c "ls /Users/sola >/dev/null 2>&1"; then
    fail "restricted account can enumerate /Users/sola"
  fi
  su - "$ACCOUNT" -c "'$ACCOUNT_HOME/.local/bin/codex' --version" >/dev/null
}

main() {
  require_root
  [[ "$#" == "1" ]] || fail "usage: sudo zsh $0 <ed25519-public-key-file>"
  local public_key
  public_key="$(validate_public_key "$1")"

  ensure_group
  ensure_account
  install_authorized_key "$public_key"
  allow_ssh_login
  install_private_codex_cli
  grant_project_access
  verify_access

  print -- ""
  print -- "sola-codex is ready. The account can read/write only the two project roots plus its own home."
  print -- "It has an independent Codex home at $ACCOUNT_HOME/.codex. Log in to Codex separately after the SSH host is configured."
}

main "$@"

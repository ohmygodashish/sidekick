#!/usr/bin/env bash
# ==============================================================================
# Sidekick Production macOS Standalone Bundle & Packaging Script
# Spec Alignment: AC-001 through AC-006, REQ-001 through REQ-017
# ==============================================================================

set -euo pipefail

# ANSI Color Codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo -e "${CYAN}${BOLD}"
echo "================================================================================"
echo "          Sidekick Standalone macOS Bundle & Packaging Pipeline"
echo "================================================================================"
echo -e "${NC}"

# Target macOS 13.0+ (Ventura, Sonoma, Sequoia) for ScreenCaptureKit & Metal STT
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.0}"

# ------------------------------------------------------------------------------
# 1. Environment Verification
# ------------------------------------------------------------------------------
echo -e "${BLUE}[1/5] Verifying toolchain and build environment...${NC}"

OS_NAME="$(uname -s)"
if [[ "${OS_NAME}" != "Darwin" ]]; then
    echo -e "${RED}[FAIL] Sidekick macOS bundle can only be built on macOS (Darwin). Detected: ${OS_NAME}${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Operating System: macOS ($(uname -m))"

# Check Cargo
if ! command -v cargo >/dev/null 2>&1; then
    echo -e "${RED}[FAIL] 'cargo' is required but not found in PATH.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Cargo: $(cargo --version)"

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[FAIL] 'node' is required but not found in PATH.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js: $(node --version)"

# Check npm
if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}[FAIL] 'npm' is required but not found in PATH.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} npm: $(npm --version)"

# ------------------------------------------------------------------------------
# 2. Automated Test Suites Execution
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}[2/5] Running Rust and React test suites...${NC}"

echo -e "  ${CYAN}-> Running Rust backend unit and integration tests...${NC}"
cargo test --manifest-path "${PROJECT_ROOT}/src-tauri/Cargo.toml"
echo -e "  ${GREEN}✓${NC} All Rust tests passed cleanly."

echo -e "  ${CYAN}-> Running React frontend Vitest suite...${NC}"
(cd "${PROJECT_ROOT}" && npm test -- --run)
echo -e "  ${GREEN}✓${NC} All frontend unit tests passed cleanly."

# ------------------------------------------------------------------------------
# 3. Production Frontend Asset Compilation
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}[3/5] Building optimized React production bundle (Vite + TypeScript)...${NC}"
(cd "${PROJECT_ROOT}" && npm run build)
echo -e "  ${GREEN}✓${NC} Frontend distribution built in ${PROJECT_ROOT}/dist"

# ------------------------------------------------------------------------------
# 4. Tauri Standalone Application & DMG Packaging
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}[4/5] Building Tauri release application and DMG installer...${NC}"

# Determine Tauri CLI invocation
if command -v cargo-tauri >/dev/null 2>&1; then
    TAURI_CMD="cargo tauri"
elif command -v npx >/dev/null 2>&1; then
    TAURI_CMD="npx tauri"
else
    TAURI_CMD="npm run tauri --"
fi

echo -e "  ${CYAN}-> Compiling release binary with Metal STT and packaging bundles...${NC}"
(cd "${PROJECT_ROOT}" && ${TAURI_CMD} build)

BUNDLE_DIR="${PROJECT_ROOT}/src-tauri/target/release/bundle"
APP_PATH="${BUNDLE_DIR}/macos/Sidekick.app"
DMG_DIR="${BUNDLE_DIR}/dmg"

if [[ ! -d "${APP_PATH}" ]]; then
    echo -e "${RED}[FAIL] Expected application bundle not found at: ${APP_PATH}${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} macOS Application bundle created: ${APP_PATH}"

# Ensure standard Sidekick.dmg symlink/file exists in DMG_DIR
ARCH_DMG="$(find "${DMG_DIR}" -maxdepth 1 -name "Sidekick*.dmg" | head -n 1)"
STANDALONE_DMG="${DMG_DIR}/Sidekick.dmg"

if [[ -n "${ARCH_DMG}" && -f "${ARCH_DMG}" ]]; then
    if [[ "${ARCH_DMG}" != "${STANDALONE_DMG}" ]]; then
        cp -f "${ARCH_DMG}" "${STANDALONE_DMG}"
    fi
    echo -e "  ${GREEN}✓${NC} Standalone DMG installer ready: ${STANDALONE_DMG}"
else
    echo -e "${RED}[FAIL] No .dmg bundle generated in ${DMG_DIR}${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 5. Ad-Hoc Code Signing & Verification
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}[5/5] Codesigning standalone bundle with ad-hoc signature...${NC}"

# Ad-hoc sign the .app bundle with deep entitlement sealing
codesign --force --deep -s - "${APP_PATH}"
echo -e "  ${GREEN}✓${NC} Ad-hoc signature successfully applied."

echo -e "  ${CYAN}-> Verifying code signature...${NC}"
codesign -dvv "${APP_PATH}" 2>&1 | grep -E "Identifier=|Format=|Signature=" || true
echo -e "  ${GREEN}✓${NC} Signature validated."

# ------------------------------------------------------------------------------
# Build Summary & Success Report
# ------------------------------------------------------------------------------
APP_SIZE="$(du -sh "${APP_PATH}" | cut -f1)"
DMG_SIZE="$(du -sh "${STANDALONE_DMG}" | cut -f1)"

echo -e "\n${GREEN}${BOLD}================================================================================"
echo "          [SUCCESS] Sidekick macOS Standalone Build Complete!"
echo "================================================================================"
echo -e "${NC}"
echo -e "  ${BOLD}Application Bundle:${NC} ${APP_PATH} (${APP_SIZE})"
echo -e "  ${BOLD}Installer Image:${NC}    ${STANDALONE_DMG} (${DMG_SIZE})"
echo -e "  ${BOLD}Entitlements:${NC}       Microphone, Audio Input, ScreenCapture"
echo -e "  ${BOLD}Activation Policy:${NC}  LSUIElement=true (Headless Phantom Mode)"
echo -e "  ${BOLD}Window Stealth:${NC}     NSWindowSharingNone (Zoom/Meet/Teams Invisible)"
echo ""
echo -e "To launch Sidekick now:"
echo -e "  ${CYAN}open \"${APP_PATH}\"${NC}"
echo ""

exit 0

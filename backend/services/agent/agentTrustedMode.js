function envTrustedMode() {
  return String(process.env.ALTA_AGENT_TRUSTED_MODE || '').trim().toLowerCase() === 'true';
}

function isTrustedOwnerMode(context = {}) {
  if (context.trusted_mode === true || context.trustedMode === true) return true;
  if (context.trusted_mode === false || context.trustedMode === false) return false;
  return envTrustedMode();
}

function trustedModeLabel(context = {}) {
  return isTrustedOwnerMode(context) ? 'trusted_owner' : 'secure_permission';
}

module.exports = {
  envTrustedMode,
  isTrustedOwnerMode,
  trustedModeLabel,
};

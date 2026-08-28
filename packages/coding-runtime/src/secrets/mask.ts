const SECRET_FILENAME =
  /(^|[/\\])(\.env|\.env\..+|credentials(\.json)?|secrets?\.json|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.key|serviceAccount.*\.json)$/i;

const SECRET_CONTENT =
  /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[a-zA-Z0-9]{16,}|tvly-[a-zA-Z0-9]+|lf-sk-[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-|AI_GATEWAY_API_KEY|SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|aws_secret_access_key)/gi;

const SECRET_LINE =
  /^\s*(?:export\s+)?(?:[A-Z0-9_]*SECRET|[A-Z0-9_]*PASSWORD|[A-Z0-9_]*TOKEN|[A-Z0-9_]*API_KEY|PRIVATE_KEY)[^=]*=.*$/gim;

export function isSecretPath(relativePath: string): boolean {
  const base = relativePath.replace(/\\/g, "/");
  return SECRET_FILENAME.test(base);
}

export function maskSecrets(text: string): { text: string; masked: boolean } {
  let masked = false;
  const next = text
    .replace(SECRET_CONTENT, () => {
      masked = true;
      return "[REDACTED]";
    })
    .replace(SECRET_LINE, (line) => {
      masked = true;
      const eq = line.indexOf("=");
      if (eq === -1) return "[REDACTED]";
      return `${line.slice(0, eq + 1)}[REDACTED]`;
    });
  return { text: next, masked };
}

export function redactObservation(text: string, maxChars: number): {
  text: string;
  truncated: boolean;
  masked: boolean;
} {
  const masked = maskSecrets(text);
  if (masked.text.length <= maxChars) {
    return { text: masked.text, truncated: false, masked: masked.masked };
  }
  return {
    text: `${masked.text.slice(0, maxChars)}\n…[truncated ${masked.text.length - maxChars} chars]`,
    truncated: true,
    masked: masked.masked,
  };
}

export function secretFilePlaceholder(relativePath: string): string {
  return `[SECRET_FILE_REDACTED:${relativePath}] 秘密ファイルの内容はモデルへ送りません。書き換えは明示承認が必要です。`;
}

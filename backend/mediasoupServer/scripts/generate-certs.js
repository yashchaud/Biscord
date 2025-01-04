const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CERT_DIR = path.join(__dirname, "../sslcert");

// Ensure the certificate directory exists
if (!fs.existsSync(CERT_DIR)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
}

// Generate OpenSSL config
const opensslConfig = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = California
L = San Francisco
O = Development
OU = Development Team
CN = localhost

[v3_req]
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`;

const configPath = path.join(CERT_DIR, "openssl.cnf");
fs.writeFileSync(configPath, opensslConfig);

try {
  // Generate private key
  execSync(
    `openssl genpkey -algorithm RSA -out "${path.join(
      CERT_DIR,
      "key.pem"
    )}" -pkeyopt rsa_keygen_bits:2048`
  );

  // Generate certificate
  execSync(
    `openssl req -x509 -new -nodes -key "${path.join(
      CERT_DIR,
      "key.pem"
    )}" -sha256 -days 365 -out "${path.join(
      CERT_DIR,
      "cert.pem"
    )}" -config "${configPath}"`
  );

  console.log("SSL certificates generated successfully!");
  console.log("");
  console.log("Next steps:");
  console.log("1. Install the certificate in your browser:");
  console.log(
    `   - Chrome: Settings -> Privacy and security -> Security -> Manage certificates -> Import`
  );
  console.log(
    `   - Firefox: Settings -> Privacy & Security -> View Certificates -> Import`
  );
  console.log("2. Import cert.pem from the sslcert directory");
  console.log("");
  console.log(
    "Note: You may need to restart your browser after importing the certificate."
  );
} catch (error) {
  console.error("Error generating certificates:", error.message);
  process.exit(1);
}

// Clean up config file
fs.unlinkSync(configPath);

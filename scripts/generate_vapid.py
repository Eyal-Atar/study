#!/usr/bin/env python3
"""Generate VAPID keys for Web Push. Run once and add output to backend/.env"""

import base64
from py_vapid import Vapid01
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# Generate a new VAPID key pair
vapid = Vapid01()
vapid.generate_keys()

# Get the private key in PEM format (for pywebpush)
private_pem = vapid.private_pem().decode()

# Get the public key in URL-safe base64 uncompressed point format (for browser subscription)
pub_bytes = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b'=').decode()

print("Add these lines to backend/.env:")
print()
print(f'VAPID_PRIVATE_KEY="{private_pem.strip()}"')
print(f'VAPID_PUBLIC_KEY="{pub_b64}"')
print('VAPID_CLAIMS_EMAIL="admin@studyflow.app"')

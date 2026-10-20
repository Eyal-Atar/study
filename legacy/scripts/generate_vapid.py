#!/usr/bin/env python3
"""Generate VAPID keys for push notifications."""

import base64

def generate_vapid_keys():
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization

        private_key = ec.generate_private_key(ec.SECP256R1())
        public_key = private_key.public_key()

        # Private key: raw 32-byte scalar, base64url encoded
        private_bytes = private_key.private_numbers().private_value.to_bytes(32, 'big')
        private_b64 = base64.urlsafe_b64encode(private_bytes).decode().rstrip('=')

        # Public key: uncompressed X9.62 point, base64url encoded (browser PushManager format)
        public_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint
        )
        public_b64 = base64.urlsafe_b64encode(public_bytes).decode().rstrip('=')

        print("# Paste these into your .env file:")
        print(f"VAPID_PUBLIC_KEY={public_b64}")
        print(f"VAPID_PRIVATE_KEY={private_b64}")

    except ImportError:
        print("Error: install cryptography — pip install cryptography")

if __name__ == "__main__":
    generate_vapid_keys()


import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

def generate_pem_keys():
    # Generate SECP256R1 private key
    private_key = ec.generate_private_key(ec.SECP256R1())
    
    # Export private key to PEM format
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')
    
    # Export public key to X9.62 uncompressed point (for PWA)
    public_key = private_key.public_key()
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint
    )
    public_b64 = base64.urlsafe_b64encode(public_bytes).decode('utf-8').rstrip('=')
    
    # Write private key to file
    with open('backend/vapid_private.pem', 'w') as f:
        f.write(private_pem)
    
    print(f"VAPID_PRIVATE_PEM_PATH=backend/vapid_private.pem")
    print(f"VAPID_PUBLIC_KEY={public_b64}")

if __name__ == "__main__":
    generate_pem_keys()

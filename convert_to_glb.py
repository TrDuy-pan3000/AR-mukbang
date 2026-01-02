"""
Convert OBJ model to GLB format using trimesh
"""
import trimesh
import os

# Paths
obj_path = "apple/apple.obj"
texture_path = "apple/apple.png"
output_path = "static/models/apple.glb"

print(f"Loading OBJ model from: {obj_path}")

# Load the mesh
mesh = trimesh.load(obj_path, force='mesh')

# Load texture if available
if os.path.exists(texture_path):
    print(f"Found texture: {texture_path}")
    # Create a material with the texture
    from PIL import Image
    texture = Image.open(texture_path)
    
    # Create PBR material
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture,
        roughnessFactor=0.3,
        metallicFactor=0.0
    )
    
    # Apply material to mesh
    mesh.visual = trimesh.visual.TextureVisuals(
        material=material,
        uv=mesh.visual.uv if hasattr(mesh.visual, 'uv') else None
    )

# Create output directory if needed
os.makedirs(os.path.dirname(output_path), exist_ok=True)

# Export as GLB
print(f"Exporting to: {output_path}")
mesh.export(output_path, file_type='glb')

print("✅ Conversion complete!")
print(f"File size: {os.path.getsize(output_path) / 1024:.1f} KB")
print(f"\nModel stats:")
print(f"  Vertices: {len(mesh.vertices)}")
print(f"  Faces: {len(mesh.faces)}")

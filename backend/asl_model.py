"""ASL letter classifiers — custom CNN variants and MobileNetV2 (legacy)."""

from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import models

ARCH_MOBILENET = "mobilenet_v2"
ARCH_CNN3 = "asl_cnn3"


class AslCNN3(nn.Module):
    """
    Custom 3-conv-block CNN for ASL fingerspelling (26 classes, trained from scratch).

    Architecture:
      Block 1 — Conv(3→64,3x3) + BN + ReLU + MaxPool(2) + Dropout2d(0.10)
      Block 2 — Conv(64→128,3x3) + BN + ReLU + MaxPool(2) + Dropout2d(0.15)
      Block 3 — Conv(128→256,3x3) + BN + ReLU + AdaptiveAvgPool(1)
      Head    — Dropout(0.40) + Linear(256→num_classes)

    Raw logits are returned; apply torch.softmax at inference time.
    Input: 96×96 RGB images, normalised to [-1, 1].
    """

    def __init__(self, num_classes: int = 26) -> None:
        super().__init__()
        self.block1 = nn.Sequential(
            nn.Conv2d(3, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.10),
        )
        self.block2 = nn.Sequential(
            nn.Conv2d(64, 128, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.15),
        )
        self.block3 = nn.Sequential(
            nn.Conv2d(128, 256, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
        )
        self.head = nn.Sequential(
            nn.Dropout(0.40),
            nn.Linear(256, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = torch.flatten(x, 1)
        return self.head(x)


def build_mobilenet(num_classes: int) -> nn.Module:
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model


def build_asl_model(arch: str, num_classes: int) -> nn.Module:
    if arch == ARCH_CNN3:
        return AslCNN3(num_classes)
    if arch == ARCH_MOBILENET:
        return build_mobilenet(num_classes)
    raise ValueError(f"Unknown ASL arch: {arch}")

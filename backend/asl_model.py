"""ASL letter classifiers — custom CNN and MobileNetV2 (legacy)."""

from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import models

ARCH_MOBILENET = "mobilenet_v2"
ARCH_ASL_CNN = "asl_cnn"


class AslLetterCNN(nn.Module):
    """Lightweight 4-block CNN for RGB ASL fingerspelling (trained from scratch)."""

    def __init__(self, num_classes: int) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(128, 256, 3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Linear(256, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = torch.flatten(x, 1)
        return self.classifier(x)


def build_mobilenet(num_classes: int) -> nn.Module:
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model


def build_asl_model(arch: str, num_classes: int) -> nn.Module:
    if arch == ARCH_ASL_CNN:
        return AslLetterCNN(num_classes)
    if arch == ARCH_MOBILENET:
        return build_mobilenet(num_classes)
    raise ValueError(f"Unknown ASL arch: {arch}")

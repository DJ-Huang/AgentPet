"""Build a conservative person-union SDF alpha mask from a video."""

import argparse

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--sample-step", type=int, default=6)
    parser.add_argument("--fade-px", type=int, default=72)
    args = parser.parse_args()

    capture = cv2.VideoCapture(args.input)
    if not capture.isOpened():
        raise RuntimeError(f"Cannot read video: {args.input}")
    ok, first_frame = capture.read()
    if not ok:
        raise RuntimeError("Video has no readable frames")
    height, width = first_frame.shape[:2]
    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)

    union = np.zeros((height, width), dtype=np.uint8)
    session = new_session("u2net_human_seg")
    frame_index = 0
    sampled = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % args.sample_step == 0:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            alpha = np.asarray(remove(Image.fromarray(rgb), session=session))[..., 3]
            union = np.maximum(union, alpha)
            sampled += 1
        frame_index += 1
    capture.release()

    # Close tiny segmentation gaps and expand the protected area by 8px before
    # calculating the outside distance: the fade must never encroach on a person.
    subject = (union >= 40).astype(np.uint8)
    subject = cv2.morphologyEx(
        subject,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
    )
    subject = cv2.dilate(
        subject,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)),
    )
    outside_distance = cv2.distanceTransform(1 - subject, cv2.DIST_L2, 5)
    normalized = np.clip(1.0 - outside_distance / args.fade_px, 0.0, 1.0)
    alpha_sdf = np.round(
        255.0 * (normalized * normalized * (3.0 - 2.0 * normalized))
    ).astype(np.uint8)
    # White RGB plus the distance field in alpha is both easy to inspect and
    # directly consumable by Chromium's CSS mask-image property.
    rgba_mask = np.dstack((
        np.full_like(alpha_sdf, 255),
        np.full_like(alpha_sdf, 255),
        np.full_like(alpha_sdf, 255),
        alpha_sdf,
    ))
    if not cv2.imwrite(args.output, rgba_mask):
        raise RuntimeError(f"Cannot write mask: {args.output}")
    print(f"frames={frame_index}; sampled={sampled}; output={args.output}")


if __name__ == "__main__":
    main()

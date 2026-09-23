import type { SVGProps } from "react";

// ボタン用のSVGアイコン群。色はcurrentColor、太めの線と丸い端で統一する
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 22, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="M11 5l-7 7 7 7" />
    </Icon>
  );
}

// とじる(ばつ印)
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Icon>
  );
}

// 右回り(時計回り)の矢印
export function RotateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}

// やり直し(左回りの矢印)
export function RestartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M4 4v5h5" />
    </Icon>
  );
}

// 入れ替え(上下で逆向きの矢印)
export function ShuffleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h15" />
      <path d="M15 4l4 4-4 4" />
      <path d="M20 16H5" />
      <path d="M9 12l-4 4 4 4" />
    </Icon>
  );
}

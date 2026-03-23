const variants = {
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  danger: {
    bg: 'bg-red-50 dark:bg-red-950/50',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  neutral: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
};

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
};

export default function StatusBadge({
  status = 'neutral',
  label,
  size = 'sm',
  pulse = false,
}) {
  const variant = variants[status] || variants.neutral;

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium
        ${variant.bg} ${variant.text} ${sizeClasses[size]}
      `}
    >
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${variant.dot}`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${variant.dot}`} />
      </span>
      {label}
    </span>
  );
}

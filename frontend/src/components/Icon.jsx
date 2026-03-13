export default function Icon({ name, style, className = '' }) {
  return <i className={`fa-solid fa-${name} ${className}`.trim()} style={style} />
}


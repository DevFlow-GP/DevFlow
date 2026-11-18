import { Link } from 'react-router-dom';
import Icon from './Icon';
import cx from '../../utils/classNames';

const DEFAULT_ICON_SIZE = { xs: 'sm', sm: 'sm', md: 'sm', lg: 'base' };

/**
 * Polymorphic button — a router <Link> when `to` is set, an <a> when `href` is set
 * (external pages), otherwise a <button>.
 *
 * variant: primary | secondary | outline | ghost | danger | warning
 * size:    xs | sm | md | lg
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconSize,
  to,
  href,
  block = false,
  type = 'button',
  className,
  children,
  ...rest
}) {
  const classes = cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className);
  const content = (
    <>
      {icon && <Icon name={icon} size={iconSize ?? DEFAULT_ICON_SIZE[size]} />}
      {children}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    );
  }

  return (
    <button type={type} className={classes} {...rest}>
      {content}
    </button>
  );
}

import { Link } from 'react-router-dom';
import Page from '../layout/Page';
import Icon from '../ui/Icon';
import { ROUTES } from '../../config/navigation';

/** The centered DevFlow card used by sign-in and the email-link pages. */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <Page variant="auth">
      <div className="auth-card">
        <div className="auth-card__head">
          <Link to={ROUTES.landing} className="auth-card__brand">
            <Icon name="rocket_launch" />
            DevFlow
          </Link>
          <h1 className="auth-card__title">{title}</h1>
          {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="auth-card__switch">{footer}</div>}
      </div>
    </Page>
  );
}

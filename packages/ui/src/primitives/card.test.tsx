import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './card';

describe('Card', () => {
  it('renders a header with title, icon and trailing slot above the body', () => {
    render(
      <Card title="Pomodoro" icon={<svg data-testid="icon" />} trailing={<span>25:00</span>}>
        Ready to focus
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Pomodoro' })).toBeInTheDocument();
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('25:00')).toBeInTheDocument();
    expect(screen.getByText('Ready to focus')).toHaveClass('muna-card__body');
  });

  it('takes a deeper heading level for cards inside a titled section', () => {
    render(
      <Card title="Display 2" headingLevel={3}>
        Follows the defaults
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Display 2' })).toBeInTheDocument();
  });

  it('omits the header when there is no title or trailing content', () => {
    const { container } = render(<Card>Body only</Card>);
    expect(container.querySelector('header')).toBeNull();
    expect(container.firstElementChild).toHaveClass('muna-card');
  });
});

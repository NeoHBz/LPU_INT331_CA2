# Platform Automation User Configurations

This directory contains user-specific configuration files for deploying automation pods.

## File Structure

Each user should have their own YAML file following this naming convention:
- `user1.yaml`
- `user2.yaml`
- etc.

## Configuration Template

```yaml
userConfig:
  username: "username"           # Platform login username
  password: "password"           # Platform login password
  homepageUrl: "http://..."     # Starting URL for the automation
  emailPrefix: "user"           # Email prefix (e.g., user@domain.com)
  targetUrl: "http://..."       # Target page URL to navigate to
  logLevel: "info"              # Logging level: debug, info, warn, error
  headless: 1                   # Browser mode: 1=headless, 0=headed

# Optional: Override default resource limits
resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi
```

## Usage

### Deploy single user
```bash
./automate.sh deploy-user user1
```

### Deploy all users
```bash
./automate.sh deploy
```

## Security Notes

⚠️ **Important**: These files contain sensitive credentials.

- **Never commit passwords to version control** in production
- Use `.gitignore` to exclude these files
- Consider using Kubernetes Secrets or external secret management systems
- For production, use environment-specific values or secret injection

## Best Practices

1. **File naming**: Use descriptive names (e.g., `alice-smith.yaml`, `bob-jones.yaml`)
2. **Resource limits**: Adjust based on your workload requirements
3. **Log levels**: Use `debug` for troubleshooting, `info` for normal operation
4. **Headless mode**: Use `1` (headless) in production, `0` (headed) for debugging

## Example

See [user1.yaml](./user1.yaml) for a complete example configuration.

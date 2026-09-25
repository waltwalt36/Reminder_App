from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from getpass import getpass


class Command(BaseCommand):
    help = "Create the single personal-testing account without admin privileges."

    def handle(self, *args, **options):
        User = get_user_model()
        username = input("Username: ").strip()
        if not username:
            raise CommandError("Username is required.")
        if User.objects.filter(username=username).exists():
            raise CommandError("That username already exists.")
        password = getpass("Password (12+ characters recommended): ")
        confirm = getpass("Confirm password: ")
        if password != confirm or len(password) < 10:
            raise CommandError("Passwords must match and be at least 10 characters.")
        User.objects.create_user(username=username, password=password)
        self.stdout.write(self.style.SUCCESS(f"Created personal app user '{username}'."))

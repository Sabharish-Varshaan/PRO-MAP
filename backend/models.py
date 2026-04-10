from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import relationship
from datetime import datetime

from db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)

    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    description = Column(Text, nullable=False)
    requirements = Column(JSON, nullable=True)
    tasks = Column(JSON, nullable=True)
    graph = Column(JSON, nullable=True)
    insights = Column(JSON, nullable=True)

    user = relationship("User", back_populates="projects")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    order_number = Column(String(64), unique=True, index=True, nullable=False)
    status = Column(String(32), nullable=False, default="ordered")
    estimated_delivery_time = Column(DateTime, nullable=True)
    delivery_provider = Column(String(64), nullable=True)
    tracking_number = Column(String(128), nullable=True)
    tracking_url = Column(String(512), nullable=True)
    tracking_data = Column(JSON, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)

    user = relationship("User")


class Session(Base):
    __tablename__ = "sessions"

    token = Column(String(512), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)

    user = relationship("User", back_populates="sessions")
